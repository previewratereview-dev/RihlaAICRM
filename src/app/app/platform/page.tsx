import { redirect } from 'next/navigation';

export default function PlatformRootPage() {
  redirect('/app/platform/dashboard');
}
