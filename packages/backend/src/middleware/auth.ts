import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export type SessionRole = 'OWNER' | 'MANAGER';

export interface AuthRequest extends Request {
  owner?: {
    businessId: string;
    email: string;
    userId?: string;
    orgId?: string;
    role?: SessionRole;
  };
}

export const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret') as {
      businessId: string;
      email: string;
      userId?: string;
      orgId?: string;
      role?: SessionRole;
    };

    if (!decoded?.businessId || !decoded?.email) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Legacy JWTs (pre multi-shop) only had businessId + email → treat as OWNER.
    req.owner = {
      businessId: decoded.businessId,
      email: decoded.email,
      userId: decoded.userId,
      orgId: decoded.orgId,
      role: decoded.role || 'OWNER',
    };
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

/** Restrict mutating billing / secrets / org admin to OWNER. */
export const requireOwnerRole = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.owner) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if ((req.owner.role || 'OWNER') !== 'OWNER') {
    return res.status(403).json({ error: 'Owner role required' });
  }
  next();
};
