import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { businessResolver } from './BusinessResolver';

const featureMap: Record<string, string> = {
  waitlist: 'enableWaitlist',
  recurring: 'enableRecurring',
  payments: 'enablePayments',
  'multi-staff': 'enableMultiStaff',
};

export const featureGuard = (feature: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const identifier = req.params.identifier || req.params.slug;
      const configField = featureMap[feature];
      if (!configField) {
        return res.status(400).json({ error: `Unknown feature: ${feature}` });
      }

      // Route public identifier resolution through the single BusinessResolver
      // (publicCode-first, slug fallback) instead of a duplicate OR lookup.
      const business = await businessResolver.resolve(identifier);

      if (!business) {
        return res.status(404).json({ error: 'Business not found' });
      }

      if (!(business as any)[configField]) {
        return res.status(403).json({ error: 'Feature not enabled' });
      }

      next();
    } catch (error) {
      console.error('Feature guard error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  };
};

export const ownerFeatureGuard = (feature: string) => {
  return async (req: any, res: Response, next: NextFunction) => {
    try {
      const businessId = req.owner?.businessId;
      if (!businessId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const configField = featureMap[feature];
      if (!configField) {
        return res.status(400).json({ error: `Unknown feature: ${feature}` });
      }

      const business = await prisma.business.findUnique({
        where: { id: businessId },
        select: { [configField]: true },
      });

      if (!business) {
        return res.status(404).json({ error: 'Business not found' });
      }

      if (!(business as any)[configField]) {
        return res.status(403).json({ error: 'Feature not enabled' });
      }

      next();
    } catch (error) {
      console.error('Owner feature guard error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  };
};