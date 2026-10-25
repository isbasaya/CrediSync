'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { Button, Checkbox, Field, Notice, PageShell } from '@/components/ui';
import { describeError, getPolicy, signup } from '@/lib/api-client';
import { useSession } from '@/lib/session';

/** Same checks the server applies; shown early so people can fix typos before submitting. */
function saIdLooksValid(raw: string): boolean {
  const id = raw.replace(/\s+/g, '');
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    let d = Number(id[12 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function toE164(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('27')) return `+${digits}`;
  if (digits.startsWith('0')) return `+27${digits.slice(1)}`;
  return `+${digits}`;
}

export default function SignupPage() {
  const router = useRouter();
  const { reload } = useSession();
  const [policyVersion, setPolicyVersion] = useState<string | null>(null);
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    mobile: '',
    saId: '',
    password: '',
  });
  const [popia, setPopia] = useState(false);
  const [creditCheck, setCreditCheck] = useState(true);
  const [marketing, setMarketing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    getPolicy()
      .then((p) => setPolicyVersion(p.popiaPolicyVersion))
      .catch(() => setError('We couldn’t load the privacy notice. Refresh the page to try again.'));
  }, []);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });
  const idError =
    touched && form.saId && !saIdLooksValid(form.saId)
      ? 'Check your 13-digit ID number'
      : undefined;
  const mobileError =
    touched && form.mobile && !/^\+27\d{9}$/.test(toE164(form.mobile))
      ? 'Use a South African mobile number, e.g. 082 123 4567'
      : undefined;
  const passwordError =
    touched && form.password && form.password.length < 10
      ? 'Use at least 10 characters'
      : undefined;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!popia || !policyVersion) {
      setError('You need to accept the privacy notice to create an account.');
      return;
    }
    if (!saIdLooksValid(form.saId) || form.password.length < 10) return;
    setBusy(true);
    setError(null);
    try {
      await signup({
        email: form.email,
        password: form.password,
        firstName: form.firstName,
        lastName: form.lastName,
        mobileNumber: toE164(form.mobile),
        saIdNumber: form.saId,
        popiaConsent: true,
        popiaPolicyVersion: policyVersion,
        creditCheckConsent: creditCheck,
        marketingConsent: marketing,
      });
      await reload();
      router.replace('/?welcome=1');
    } catch (err) {
      setError(describeError(err, 'We couldn’t create your account.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AppHeader />
      <PageShell
        title="Create your account"
        intro="It takes about two minutes. We’ll email you a link to confirm your address."
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="firstName"
              label="First name"
              autoComplete="given-name"
              required
              value={form.firstName}
              onChange={set('firstName')}
            />
            <Field
              id="lastName"
              label="Surname"
              autoComplete="family-name"
              required
              value={form.lastName}
              onChange={set('lastName')}
            />
          </div>
          <Field
            id="email"
            label="Email address"
            type="email"
            autoComplete="email"
            required
            value={form.email}
            onChange={set('email')}
          />
          <Field
            id="mobile"
            label="Mobile number"
            type="tel"
            autoComplete="tel"
            required
            value={form.mobile}
            onChange={set('mobile')}
            error={mobileError}
          />
          <Field
            id="saId"
            label="South African ID number"
            inputMode="numeric"
            autoComplete="off"
            required
            value={form.saId}
            onChange={set('saId')}
            error={idError}
            hint="The bureaus use your ID number to find your records. We store it encrypted and never show it in full."
          />
          <Field
            id="password"
            label="Password"
            type="password"
            autoComplete="new-password"
            required
            value={form.password}
            onChange={set('password')}
            error={passwordError}
            hint="At least 10 characters."
          />

          <fieldset className="flex flex-col gap-4 rounded-xl border border-border-default p-4">
            <legend className="px-1 text-sm font-semibold text-text-primary">
              Your permissions
            </legend>
            <Checkbox
              id="popia"
              label="I accept the CrediSync privacy notice (required)"
              checked={popia}
              onChange={(e) => setPopia(e.target.checked)}
            >
              We process your personal information only to show your credit profile, help you
              dispute errors and assess bank readiness, as allowed by the Protection of Personal
              Information Act. Version {policyVersion ?? '…'}.
            </Checkbox>
            <Checkbox
              id="creditCheck"
              label="Request my credit reports from TransUnion, Experian and XDS"
              checked={creditCheck}
              onChange={(e) => setCreditCheck(e.target.checked)}
            >
              Checking your own report does not affect your score. You can withdraw this at any
              time.
            </Checkbox>
            <Checkbox
              id="marketing"
              label="Send me tips and product news (optional)"
              checked={marketing}
              onChange={(e) => setMarketing(e.target.checked)}
            />
          </fieldset>

          <Button type="submit" busy={busy} disabled={!policyVersion}>
            Create account
          </Button>
        </form>
        <p className="text-sm text-text-secondary">
          Already have an account?{' '}
          <Link href="/login" className="font-semibold text-teal-700 hover:text-teal-800">
            Sign in
          </Link>
        </p>
      </PageShell>
    </>
  );
}
