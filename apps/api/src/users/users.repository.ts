import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, asc, eq } from 'drizzle-orm';
import type { User } from '../auth/user.js';
import type { Database, Executor } from '../db/db.module.js';
import { type StaffRole, type UserRow, users } from './users.schema.js';

/** As the auth package normalizes addresses: an accent typed as two code points matches. */
export const normalizeEmail = (email: string) => email.trim().normalize('NFC').toLowerCase();

const toUser = ({ id, clinicId, email, name, role }: UserRow): User => ({ id, clinicId, email, name, role });

export interface StaffMember extends User {
  active: boolean;
  createdAt: Date;
}

/** Only `User` objects leave this class: password hashes stay inside. */
@Injectable()
export class UsersRepository {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async create(
    input: { clinicId: string; email: string; name: string; role: StaffRole; passwordHash: string },
    tx: Executor = this.db,
  ): Promise<User> {
    const [row] = await tx
      .insert(users)
      .values({ ...input, email: normalizeEmail(input.email) })
      .returning();
    return toUser(row);
  }

  /** Active users only: a deactivated account loses access on its next request. */
  async findActiveById(id: string): Promise<User | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.active, true)));
    return row ? toUser(row) : null;
  }

  async existsByEmail(email: string): Promise<boolean> {
    const [row] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, normalizeEmail(email)));
    return !!row;
  }

  /** For password sign-in only. */
  async findCredentials(email: string): Promise<{ user: User; passwordHash: string | null; active: boolean } | null> {
    const [row] = await this.db.select().from(users).where(eq(users.email, normalizeEmail(email)));
    return row ? { user: toUser(row), passwordHash: row.passwordHash, active: row.active } : null;
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.db.update(users).set({ passwordHash }).where(eq(users.id, id));
  }

  async listByClinic(clinicId: string): Promise<StaffMember[]> {
    const rows = await this.db.select().from(users).where(eq(users.clinicId, clinicId)).orderBy(asc(users.name));
    return rows.map((row) => ({ ...toUser(row), active: row.active, createdAt: row.createdAt }));
  }

  /** Scoped by clinic: an id from another clinic is simply not found. */
  async findInClinic(clinicId: string, id: string): Promise<StaffMember | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.clinicId, clinicId), eq(users.id, id)));
    return row ? { ...toUser(row), active: row.active, createdAt: row.createdAt } : null;
  }

  async updateInClinic(
    clinicId: string,
    id: string,
    changes: { role?: StaffRole; active?: boolean },
  ): Promise<StaffMember | null> {
    const [row] = await this.db
      .update(users)
      .set(changes)
      .where(and(eq(users.clinicId, clinicId), eq(users.id, id)))
      .returning();
    return row ? { ...toUser(row), active: row.active, createdAt: row.createdAt } : null;
  }

  async countActiveOwners(clinicId: string, tx: Executor = this.db): Promise<number> {
    const rows = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.clinicId, clinicId), eq(users.role, 'owner'), eq(users.active, true)));
    return rows.length;
  }
}
