import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM for clinical notes, with a versioned keyring for rotation.
 *
 * - A fresh 96-bit IV per encryption (never reused with a key).
 * - The authentication tag detects any change to the ciphertext.
 * - Additional authenticated data binds the ciphertext to its row (clinic, patient, author, note
 *   id): copying one note's ciphertext onto another row makes decryption fail, so someone with
 *   database access can't move content between patients or authors.
 * - Keys live outside the database (environment), so a database dump alone reveals nothing.
 */
export interface EncryptedNote {
  ciphertext: string;
  iv: string;
  tag: string;
  keyVersion: number;
}

export class NoteIntegrityError extends Error {}

export class NoteCipher {
  private readonly keys: Map<number, Buffer>;
  private readonly current: number;

  /** `keyring` is "1:<base64 32 bytes>,2:<base64 32 bytes>"; the highest version encrypts. */
  constructor(keyring: string) {
    this.keys = new Map(
      keyring.split(',').map((entry) => {
        const [version, key] = entry.trim().split(':');
        const buffer = Buffer.from(key ?? '', 'base64');
        if (!/^\d+$/.test(version ?? '') || buffer.length !== 32) {
          throw new Error('NOTES_ENCRYPTION_KEYS must be "version:base64key" entries with 32-byte keys');
        }
        return [Number(version), buffer] as const;
      }),
    );
    this.current = Math.max(...this.keys.keys());
  }

  encrypt(plaintext: string, aad: string): EncryptedNote {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.current)!, iv);
    cipher.setAAD(Buffer.from(aad));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      keyVersion: this.current,
    };
  }

  decrypt(note: EncryptedNote, aad: string): string {
    const key = this.keys.get(note.keyVersion);
    if (!key) {
      throw new NoteIntegrityError(`Unknown key version ${note.keyVersion}`);
    }
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(note.iv, 'base64'));
      decipher.setAAD(Buffer.from(aad));
      decipher.setAuthTag(Buffer.from(note.tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(note.ciphertext, 'base64')), decipher.final()]).toString('utf8');
    } catch {
      throw new NoteIntegrityError('Note failed authentication: tampered, moved or wrong key');
    }
  }
}

/** What a note's ciphertext is bound to. */
export const noteAad = (n: { clinicId: string; patientId: string; authorId: string; id: string }) =>
  `note.v1:${n.clinicId}:${n.patientId}:${n.authorId}:${n.id}`;
