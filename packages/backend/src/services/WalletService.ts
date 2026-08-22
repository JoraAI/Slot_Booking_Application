import prisma from '../lib/prisma';

/**
 * WhatsApp prepaid wallet — integer paise only. Never negative.
 *
 * Reserve/finalize/release is the core money path:
 *   reserve  → single atomic `updateMany(balancePaise >= amount)` decrement
 *              (parallel reserves cannot overspend) + PENDING RESERVATION ledger row
 *   finalize → atomically claim the PENDING row as a WHATSAPP_CHARGE (Meta accepted)
 *   release  → atomically claim + credit back (Meta rejected / send failed)
 *
 * Recharge idempotency is keyed on WalletTransaction.providerPaymentId @unique:
 * the ledger insert is the lock; a concurrent duplicate verify fails the unique
 * constraint and the paired balance increment rolls back with it.
 */

export type ReserveResult =
  | { ok: true; reservationId: string; balancePaise: number }
  | { ok: false; reason: 'INSUFFICIENT_CREDITS' | 'WALLET_FROZEN' };

export type ReserveOpts = {
  description?: string;
  referenceType?: string;
  referenceId?: string;
};

class WalletService {
  async getOrCreate(businessId: string) {
    const existing = await prisma.wallet.findUnique({ where: { businessId } });
    if (existing) return existing;
    try {
      return await prisma.wallet.create({ data: { businessId } });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        const winner = await prisma.wallet.findUnique({ where: { businessId } });
        if (winner) return winner;
      }
      throw e;
    }
  }

  async getWallet(businessId: string) {
    return this.getOrCreate(businessId);
  }

  async getView(businessId: string, utilityPricePaise: number | null) {
    const wallet = await this.getOrCreate(businessId);
    return {
      balancePaise: wallet.balancePaise,
      currency: wallet.currency,
      status: wallet.status,
      lowBalanceThresholdPaise: wallet.lowBalanceThresholdPaise,
      lowBalance: wallet.balancePaise <= wallet.lowBalanceThresholdPaise,
      estimatedMessages: utilityPricePaise && utilityPricePaise > 0
        ? Math.floor(wallet.balancePaise / utilityPricePaise)
        : null,
    };
  }

  /**
   * Reserve costPaise atomically. Hard stop on insufficient balance — caller must
   * NOT call Meta and MUST NOT record a charge.
   */
  async reserve(businessId: string, amountPaise: number, opts: ReserveOpts = {}): Promise<ReserveResult> {
    if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
      throw new Error('Invalid reservation amount');
    }
    const wallet = await this.getOrCreate(businessId);
    if (wallet.status === 'FROZEN') return { ok: false, reason: 'WALLET_FROZEN' };

    const claimed = await prisma.wallet.updateMany({
      where: { businessId, status: 'ACTIVE', balancePaise: { gte: amountPaise } },
      data: { balancePaise: { decrement: amountPaise }, version: { increment: 1 } },
    });
    if (claimed.count === 0) return { ok: false, reason: 'INSUFFICIENT_CREDITS' };

    const updated = await prisma.wallet.findUnique({ where: { businessId } });
    const balanceAfter = updated?.balancePaise ?? 0;
    const reservation = await prisma.walletTransaction.create({
      data: {
        businessId,
        type: 'RESERVATION',
        amountPaise: -amountPaise,
        balanceBeforePaise: balanceAfter + amountPaise,
        balanceAfterPaise: balanceAfter,
        status: 'PENDING',
        referenceType: opts.referenceType,
        referenceId: opts.referenceId,
        description: opts.description || 'WhatsApp message reservation',
      },
    });
    return { ok: true, reservationId: reservation.id, balancePaise: balanceAfter };
  }

  /** Meta accepted the message: claim the PENDING reservation as a charge. */
  async finalizeReservation(reservationId: string, providerMessageId?: string | null) {
    const claimed = await prisma.walletTransaction.updateMany({
      where: { id: reservationId, status: 'PENDING' },
      data: {
        status: 'COMPLETED',
        type: 'WHATSAPP_CHARGE',
        ...(providerMessageId ? { metadata: { providerMessageId } as any } : {}),
      },
    });
    return claimed.count > 0;
  }

  /** Meta rejected / send failed: claim + credit the reservation back. */
  async releaseReservation(reservationId: string, reason: string) {
    const reservation = await prisma.walletTransaction.findUnique({ where: { id: reservationId } });
    if (!reservation) return null;
    const claimed = await prisma.walletTransaction.updateMany({
      where: { id: reservationId, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
    if (claimed.count === 0) return null; // already finalized/released

    const amountPaise = Math.abs(reservation.amountPaise);
    await prisma.wallet.update({
      where: { businessId: reservation.businessId },
      data: { balancePaise: { increment: amountPaise }, version: { increment: 1 } },
    });
    const updated = await prisma.wallet.findUnique({ where: { businessId: reservation.businessId } });
    const balanceAfter = updated?.balancePaise ?? 0;
    return prisma.walletTransaction.create({
      data: {
        businessId: reservation.businessId,
        type: 'RESERVATION_RELEASE',
        amountPaise,
        balanceBeforePaise: balanceAfter - amountPaise,
        balanceAfterPaise: balanceAfter,
        status: 'COMPLETED',
        referenceType: reservation.referenceType,
        referenceId: reservation.referenceId,
        description: `Released: ${reason.slice(0, 300)}`,
      },
    });
  }

  /**
   * Credit a verified Razorpay recharge. Idempotent on providerPaymentId; throws
   * if the payment id already belongs to a different business (replay guard).
   */
  async creditRecharge(
    businessId: string,
    providerPaymentId: string,
    amountPaise: number,
    opts: { description?: string; referenceType?: string; referenceId?: string } = {}
  ): Promise<{ alreadyCredited: boolean; balancePaise: number; transactionId: string }> {
    if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
      throw new Error('Invalid recharge amount');
    }
    await this.getOrCreate(businessId);

    const existing = await prisma.walletTransaction.findUnique({ where: { providerPaymentId } });
    if (existing) {
      if (existing.businessId !== businessId) {
        throw new Error('Payment reference already used by another account');
      }
      const wallet = await this.getOrCreate(businessId);
      return { alreadyCredited: true, balancePaise: wallet.balancePaise, transactionId: existing.id };
    }

    try {
      return await prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.findUniqueOrThrow({ where: { businessId } });
        const before = wallet.balancePaise;
        const after = before + amountPaise;
        const ledger = await tx.walletTransaction.create({
          data: {
            businessId,
            type: 'RECHARGE',
            amountPaise,
            balanceBeforePaise: before,
            balanceAfterPaise: after,
            status: 'COMPLETED',
            providerPaymentId,
            referenceType: opts.referenceType,
            referenceId: opts.referenceId,
            description: opts.description || 'WhatsApp wallet recharge',
          },
        });
        await tx.wallet.update({
          where: { businessId },
          data: { balancePaise: { increment: amountPaise }, version: { increment: 1 } },
        });
        return { alreadyCredited: false, balancePaise: after, transactionId: ledger.id };
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        const winner = await prisma.walletTransaction.findUnique({ where: { providerPaymentId } });
        const wallet = await this.getOrCreate(businessId);
        return { alreadyCredited: true, balancePaise: wallet.balancePaise, transactionId: winner?.id || '' };
      }
      throw e;
    }
  }

  /** Admin-only manual adjustment (internal route). amountPaise signed. */
  async adjust(businessId: string, amountPaise: number, description: string) {
    if (!Number.isInteger(amountPaise) || amountPaise === 0) throw new Error('Invalid adjustment amount');
    const wallet = await this.getOrCreate(businessId);
    const claimed = await prisma.wallet.updateMany({
      where: { businessId, balancePaise: { gte: Math.max(0, -amountPaise) } },
      data: { balancePaise: { increment: amountPaise }, version: { increment: 1 } },
    });
    if (claimed.count === 0) throw new Error('Insufficient balance for adjustment');
    const updated = await prisma.wallet.findUnique({ where: { businessId } });
    const balanceAfter = updated?.balancePaise ?? 0;
    return prisma.walletTransaction.create({
      data: {
        businessId,
        type: 'ADJUSTMENT',
        amountPaise,
        balanceBeforePaise: balanceAfter - amountPaise,
        balanceAfterPaise: balanceAfter,
        status: 'COMPLETED',
        description,
      },
    });
  }

  async transactions(businessId: string, limit = 50) {
    return prisma.walletTransaction.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
  }

  async balance(businessId: string): Promise<number> {
    return (await this.getOrCreate(businessId)).balancePaise;
  }
}

export const walletService = new WalletService();
