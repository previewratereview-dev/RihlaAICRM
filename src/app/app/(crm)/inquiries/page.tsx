import { CrmShell } from '@/components/crm-shell';
import { isNewInquiriesReadEnabled } from '@/lib/feature-flags';

export default function InquiriesPage() {
  const useNewRead = isNewInquiriesReadEnabled();
  return <CrmShell initialTab="inquiries" useNewInquiriesRead={useNewRead} />;
}
