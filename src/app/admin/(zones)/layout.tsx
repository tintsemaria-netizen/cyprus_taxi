'use client';

// The price / zone tabs share one menu and ONE map (operator 2026-11-25): switching «Фикс. цены» ↔ «Минимум
// предзаказа» ↔ «Запретная зона» ↔ «Точки подачи» ↔ «Стоянки» changes only the side panel and what is drawn —
// the map stays where it is. URLs are unchanged (route group).
import { StaffShell } from '@/components/staff/StaffShell';
import { ZoneWorkspace } from '@/components/staff/ZoneWorkspace';

export default function ZonesLayout({ children }: { children: React.ReactNode }) {
  return <StaffShell roles={['ADMIN']}>{() => <ZoneWorkspace>{children}</ZoneWorkspace>}</StaffShell>;
}
