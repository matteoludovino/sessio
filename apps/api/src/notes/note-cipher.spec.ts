import { randomBytes } from 'node:crypto';
import { NoteCipher, NoteIntegrityError } from './note-cipher.js';

const key = () => randomBytes(32).toString('base64');
const k1 = key();
const k2 = key();
const aad = 'note.v1:clinic:patient:author:note-1';

describe('NoteCipher', () => {
  const cipher = new NoteCipher(`1:${k1}`);

  it('round-trips, without the plaintext in what is stored', () => {
    const text = 'Paciente relata melhora do sono. Retomar exercícios de respiração.';
    const enc = cipher.encrypt(text, aad);
    expect(Buffer.from(enc.ciphertext, 'base64').toString('utf8')).not.toContain('sono');
    expect(cipher.decrypt(enc, aad)).toBe(text);
  });

  it('uses a fresh IV every time: the same text never encrypts the same way', () => {
    const a = cipher.encrypt('igual', aad);
    const b = cipher.encrypt('igual', aad);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('detects a modified ciphertext', () => {
    const enc = cipher.encrypt('conteúdo sigiloso', aad);
    const bytes = Buffer.from(enc.ciphertext, 'base64');
    bytes[0] ^= 0x01;
    expect(() => cipher.decrypt({ ...enc, ciphertext: bytes.toString('base64') }, aad)).toThrow(NoteIntegrityError);
  });

  it('refuses a ciphertext moved to another row (bound to its row by the AAD)', () => {
    const enc = cipher.encrypt('nota do paciente A', aad);
    expect(() => cipher.decrypt(enc, 'note.v1:clinic:patient-B:author:note-2')).toThrow(NoteIntegrityError);
  });

  it('rotation: old notes still decrypt with their key version, new ones use the newest key', () => {
    const old = cipher.encrypt('antes da rotação', aad);
    const rotated = new NoteCipher(`1:${k1},2:${k2}`);
    expect(rotated.decrypt(old, aad)).toBe('antes da rotação');
    expect(rotated.encrypt('depois', aad).keyVersion).toBe(2);
    expect(() => new NoteCipher(`2:${k2}`).decrypt(old, aad)).toThrow(/Unknown key version 1/);
  });

  it('refuses malformed keyrings', () => {
    expect(() => new NoteCipher('1:short')).toThrow(/32-byte/);
    expect(() => new NoteCipher(`x:${k1}`)).toThrow();
  });
});
