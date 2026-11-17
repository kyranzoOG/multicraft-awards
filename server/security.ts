import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { User } from '@supabase/supabase-js';
import { getSupabaseAdminClient, getSupabasePublicClient } from './supabaseAdmin.ts';

const DISCORD_EPOCH = 1420070400000n;

export interface AuthenticatedRequest extends Request {
  authUser?: User;
  adminRole?: {
    id: string;
    email: string;
    role: 'super_admin' | 'awards_admin' | 'moderator';
  };
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

/**
 * Calculates exact account creation timestamp from an immutable Discord Snowflake ID.
 */
export function parseDiscordSnowflakeAge(discordId: string): {
  createdAtIso: string;
  ageDays: number;
  isEligible: boolean;
} | null {
  try {
    if (!/^\d{17,22}$/.test(discordId)) {
      return null;
    }
    const snowflake = BigInt(discordId);
    const timestampMs = Number((snowflake >> 22n) + DISCORD_EPOCH);
    const nowMs = Date.now();
    if (timestampMs > nowMs || timestampMs < Number(DISCORD_EPOCH)) {
      return null;
    }
    const ageDays = Math.floor((nowMs - timestampMs) / 86400000);
    return {
      createdAtIso: new Date(timestampMs).toISOString(),
      ageDays,
      isEligible: ageDays >= 30,
    };
  } catch {
    return null;
  }
}

interface RateBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateBucket>();

export function createRateLimiter(options: { windowMs: number; max: number; prefix: string }) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${options.prefix}:${getClientIp(req)}`;
    const now = Date.now();
    const existing = buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }
    if (existing.count >= options.max) {
      res.status(429).json({
        error: 'Too many requests. Please wait before trying again.',
      });
      return;
    }
    existing.count += 1;
    next();
  };
}

export async function requireAuthenticatedUser(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  const supabasePublic = getSupabasePublicClient();
  if (!supabasePublic) {
    res.status(503).json({ error: 'Supabase backend is not configured.' });
    return;
  }

  const { data, error } = await supabasePublic.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: 'Invalid or expired authentication session.' });
    return;
  }

  req.authUser = data.user;
  next();
}

export async function requireAdministrator(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  await requireAuthenticatedUser(req, res, async () => {
    const adminClient = getSupabaseAdminClient();
    if (!adminClient || !req.authUser) {
      res.status(503).json({ error: 'Supabase service role credentials are required for admin operations.' });
      return;
    }

    const normalizedEmail = (req.authUser.email || '').trim().toLowerCase();
    const { data: roleRow, error } = await adminClient
      .from('administrator_roles')
      .select('id, email, role, is_active, auth_user_id')
      .or(normalizedEmail ? `auth_user_id.eq.${req.authUser.id},email.eq.${normalizedEmail}` : `auth_user_id.eq.${req.authUser.id}`)
      .eq('is_active', true)
      .maybeSingle();

    if (error || !roleRow) {
      res.status(403).json({ error: 'Administrator privileges required.' });
      return;
    }

    if (!roleRow.auth_user_id) {
      await adminClient
        .from('administrator_roles')
        .update({ auth_user_id: req.authUser.id })
        .eq('id', roleRow.id);
    }

    req.adminRole = {
      id: roleRow.id,
      email: roleRow.email,
      role: roleRow.role,
    };
    next();
  });
}

export async function writeAuditLog(params: {
  actorUserId?: string | null;
  actorEmail?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
}): Promise<void> {
  const adminClient = getSupabaseAdminClient();
  if (!adminClient) return;
  await adminClient.from('audit_logs').insert({
    actor_user_id: params.actorUserId ?? null,
    actor_email: params.actorEmail ?? null,
    action: params.action,
    entity_type: params.entityType,
    entity_id: params.entityId ?? null,
    details: params.details ?? {},
    ip_address: params.ipAddress ?? null,
  });
}
