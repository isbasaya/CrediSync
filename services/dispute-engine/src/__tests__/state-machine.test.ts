import { describe, it, expect } from 'vitest';
import { assertValidTransition, isTerminalStatus, InvalidTransitionError } from '../state-machine';

describe('dispute state-machine', () => {
  describe('valid transitions', () => {
    it('allows draft -> submitted', () => {
      expect(() => assertValidTransition('draft', 'submitted')).not.toThrow();
    });

    it('allows submitted -> under_review', () => {
      expect(() => assertValidTransition('submitted', 'under_review')).not.toThrow();
    });

    it('allows submitted -> escalated_ncr', () => {
      expect(() => assertValidTransition('submitted', 'escalated_ncr')).not.toThrow();
    });

    it('allows under_review -> resolved_upheld', () => {
      expect(() => assertValidTransition('under_review', 'resolved_upheld')).not.toThrow();
    });

    it('allows under_review -> resolved_rejected', () => {
      expect(() => assertValidTransition('under_review', 'resolved_rejected')).not.toThrow();
    });

    it('allows resolved_rejected -> escalated_ncr', () => {
      expect(() => assertValidTransition('resolved_rejected', 'escalated_ncr')).not.toThrow();
    });
  });

  describe('invalid transitions', () => {
    it('rejects draft -> resolved_upheld', () => {
      expect(() => assertValidTransition('draft', 'resolved_upheld')).toThrow(
        InvalidTransitionError,
      );
    });

    it('rejects submitted -> draft', () => {
      expect(() => assertValidTransition('submitted', 'draft')).toThrow(InvalidTransitionError);
    });

    it('rejects escalated_ncr -> any', () => {
      expect(() => assertValidTransition('escalated_ncr', 'draft')).toThrow(InvalidTransitionError);
    });

    it('rejects resolved_upheld -> any', () => {
      expect(() => assertValidTransition('resolved_upheld', 'escalated_ncr')).toThrow(
        InvalidTransitionError,
      );
    });
  });

  describe('terminal statuses', () => {
    it('marks resolved_upheld as terminal', () => {
      expect(isTerminalStatus('resolved_upheld')).toBe(true);
    });

    it('marks escalated_ncr as terminal', () => {
      expect(isTerminalStatus('escalated_ncr')).toBe(true);
    });

    it('marks draft as non-terminal', () => {
      expect(isTerminalStatus('draft')).toBe(false);
    });

    it('marks submitted as non-terminal', () => {
      expect(isTerminalStatus('submitted')).toBe(false);
    });
  });
});
