import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Dialog, Field, Input, PageHeader, Select } from '../components/ui';
import { api } from '../lib/api';
import { ROLE_LABEL } from '../lib/format';
import { useStaff } from '../lib/queries';
import { useSession } from '../lib/session';
import type { Role, StaffMember } from '../lib/types';

export function TeamPage() {
  const { user } = useSession();
  const owner = user.role === 'owner';
  const staff = useStaff();
  const [inviting, setInviting] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; role?: Role; active?: boolean }) => api.patch<StaffMember>(`/staff/${id}`, body),
  });

  return (
    <>
      <PageHeader title="Equipe" description="Quem acessa a agenda da clínica" actions={owner && <Button onClick={() => (setSent(null), setInviting(true))}>Convidar</Button>} />
      {sent && (
        <div className="mb-4">
          <Alert tone="success">Convite enviado para {sent}. O link vale por 7 dias.</Alert>
        </div>
      )}
      {update.error && (
        <div className="mb-4">
          <Alert>{update.error.message}</Alert>
        </div>
      )}
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-5 py-3 font-medium">Nome</th>
              <th className="px-5 py-3 font-medium">Papel</th>
              <th className="px-5 py-3 font-medium">Situação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {staff.data?.map((m) => (
              <tr key={m.id}>
                <td className="px-5 py-3">
                  <p className="font-medium text-stone-900">
                    {m.name} {m.id === user.id && <span className="font-normal text-stone-500">(você)</span>}
                  </p>
                  <p className="text-xs text-stone-500">{m.email}</p>
                </td>
                <td className="px-5 py-3">
                  {owner && m.id !== user.id ? (
                    <Select aria-label={`Papel de ${m.name}`} className="w-auto" value={m.role} onChange={(e) => update.mutate({ id: m.id, role: e.target.value as Role })}>
                      {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    ROLE_LABEL[m.role]
                  )}
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <Badge color={m.active ? '#2f766c' : '#a8a29e'}>{m.active ? 'Ativo' : 'Desativado'}</Badge>
                    {owner && m.id !== user.id && (
                      <Button variant={m.active ? 'ghost' : 'secondary'} className="py-1 text-xs" onClick={() => update.mutate({ id: m.id, active: !m.active })}>
                        {m.active ? 'Desativar' : 'Reativar'}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="mt-3 text-xs text-stone-500">Desativar encerra as sessões abertas da pessoa na hora. A clínica sempre mantém pelo menos uma proprietária(o).</p>
      <Dialog open={inviting} onClose={() => setInviting(false)} title="Convidar para a equipe">
        <InviteForm
          onSent={(email) => {
            setInviting(false);
            setSent(email);
          }}
        />
      </Dialog>
    </>
  );
}

function InviteForm({ onSent }: { onSent: (email: string) => void }) {
  const invite = useMutation({
    mutationFn: (body: Record<string, string>) => api.post('/staff/invitations', body),
    onSuccess: (_, body) => onSent(body.email),
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        invite.mutate(Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>);
      }}
    >
      <Field label="Nome">{(id) => <Input id={id} name="name" required minLength={2} />}</Field>
      <Field label="E-mail">{(id) => <Input id={id} name="email" type="email" required />}</Field>
      <Field label="Papel">
        {(id) => (
          <Select id={id} name="role" defaultValue="psychologist">
            <option value="psychologist">Psicóloga(o)</option>
            <option value="reception">Recepção</option>
          </Select>
        )}
      </Field>
      {invite.error && <Alert>{invite.error.message}</Alert>}
      <div className="flex justify-end">
        <Button type="submit" busy={invite.isPending}>
          Enviar convite
        </Button>
      </div>
    </form>
  );
}
