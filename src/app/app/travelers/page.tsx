import { CrmShell } from '@/components/crm-shell';
import { isNewTravelersReadEnabled } from '@/lib/feature-flags';

export default function TravelersPage() {
  const useNewRead = isNewTravelersReadEnabled();
  return <CrmShell initialTab="travelers" useNewTravelersRead={useNewRead} />;
}
