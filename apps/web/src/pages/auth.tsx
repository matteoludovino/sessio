import { useMutation } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { Alert, Button, Field, Input } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useRefreshSession } from '../lib/session';

function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-2xl font-bold tracking-tight text-brand-700">Sessio</p>
          <h1 className="mt-4 text-xl font-semibold text-stone-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-stone-500">{subtitle}</p>}
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">{children}</div>
      </div>
    </main>
  );
}

const formData = (e: FormEvent<HTMLFormElement>) => Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;

export function SignIn() {
  const navigate = useNavigate();
  const location = useLocation();
  const refresh = useRefreshSession();
  const signIn = useMutation({
    mutationFn: (body: Record<string, string>) => api.post('/auth/sign-in', body),
    onSuccess: async () => {
      await refresh();
      navigate((location.state as { from?: string } | null)?.from ?? '/agenda', { replace: true });
    },
  });
  const demo = import.meta.env.VITE_DEMO_HINT as string | undefined;
  return (
    <AuthShell title="Entrar" subtitle="Agenda e prontuário da sua clínica">
      <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), signIn.mutate(formData(e)))}>
        <Field label="E-mail">{(id) => <Input id={id} name="email" type="email" autoComplete="email" required />}</Field>
        <Field label="Senha">{(id) => <Input id={id} name="password" type="password" autoComplete="current-password" required />}</Field>
        {signIn.error && <Alert>{signIn.error.message}</Alert>}
        <Button type="submit" className="w-full" busy={signIn.isPending}>
          Entrar
        </Button>
      </form>
      {demo && <p className="mt-4 rounded-lg bg-brand-50 p-3 text-xs text-brand-700">{demo}</p>}
      <p className="mt-6 text-center text-sm text-stone-500">
        Nova clínica? <Link className="font-medium text-brand-700 hover:underline" to="/criar-clinica">Crie sua conta</Link>
      </p>
    </AuthShell>
  );
}

export function SignUp() {
  const navigate = useNavigate();
  const refresh = useRefreshSession();
  const signUp = useMutation({
    mutationFn: (body: Record<string, string>) => api.post('/auth/sign-up', body),
    onSuccess: async () => {
      await refresh();
      navigate('/agenda', { replace: true });
    },
  });
  return (
    <AuthShell title="Criar clínica" subtitle="Você será a pessoa proprietária da conta">
      <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), signUp.mutate(formData(e)))}>
        <Field label="Nome da clínica">{(id) => <Input id={id} name="clinicName" required minLength={2} />}</Field>
        <Field label="Seu nome">{(id) => <Input id={id} name="name" autoComplete="name" required minLength={2} />}</Field>
        <Field label="E-mail">{(id) => <Input id={id} name="email" type="email" autoComplete="email" required />}</Field>
        <Field label="Senha" hint="Pelo menos 12 caracteres. Uma frase funciona bem.">
          {(id) => <Input id={id} name="password" type="password" autoComplete="new-password" required minLength={12} />}
        </Field>
        {signUp.error && <Alert>{signUp.error.message}</Alert>}
        <Button type="submit" className="w-full" busy={signUp.isPending}>
          Criar clínica
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-stone-500">
        Já tem conta? <Link className="font-medium text-brand-700 hover:underline" to="/entrar">Entrar</Link>
      </p>
    </AuthShell>
  );
}

export function AcceptInvitation() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const refresh = useRefreshSession();
  const [mismatch, setMismatch] = useState(false);
  const accept = useMutation({
    mutationFn: (password: string) => api.post('/invitations/accept', { token, password }),
    onSuccess: async () => {
      await refresh();
      navigate('/agenda', { replace: true });
    },
  });
  return (
    <AuthShell title="Aceitar convite" subtitle="Crie sua senha para entrar na equipe">
      {!token ? (
        <Alert>Link de convite incompleto. Abra o link do e-mail novamente.</Alert>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const { password, confirm } = formData(e);
            setMismatch(password !== confirm);
            if (password === confirm) accept.mutate(password);
          }}
        >
          <Field label="Senha" hint="Pelo menos 12 caracteres.">
            {(id) => <Input id={id} name="password" type="password" autoComplete="new-password" required minLength={12} />}
          </Field>
          <Field label="Repita a senha">{(id) => <Input id={id} name="confirm" type="password" autoComplete="new-password" required />}</Field>
          {mismatch && <Alert>As senhas não coincidem.</Alert>}
          {accept.error && <Alert>{accept.error instanceof ApiError && accept.error.status === 410 ? 'Este convite expirou ou já foi usado. Peça um novo.' : accept.error.message}</Alert>}
          <Button type="submit" className="w-full" busy={accept.isPending}>
            Entrar na equipe
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
