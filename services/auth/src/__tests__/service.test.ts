import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { signToken, verifyToken, AuthError } from '../service';

describe('auth tokens', () => {
  const mockUser = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'test@example.com',
    first_name: 'Test',
    last_name: 'User',
    is_verified: true,
    is_active: true,
  };

  it('signs a token with user claims', () => {
    const token = signToken(mockUser);
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });

  it('verifies a valid token', () => {
    const token = signToken(mockUser);
    const decoded = verifyToken(token);
    expect(decoded.sub).toBe(mockUser.id);
    expect(decoded.email).toBe(mockUser.email);
    expect(decoded.name).toBe('Test User');
  });

  it('throws AuthError for invalid token', () => {
    expect(() => verifyToken('invalid-token')).toThrow(AuthError);
  });

  it('throws AuthError for expired token', () => {
    const expired = jwt.sign(
      { sub: mockUser.id, email: mockUser.email, name: 'Test User' },
      'dev-secret-change-in-production',
      { expiresIn: '0s' }
    );
    expect(() => verifyToken(expired)).toThrow(AuthError);
  });
});
