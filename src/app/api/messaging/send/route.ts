import { NextRequest, NextResponse } from 'next/server';
import { guardRoute } from '@/lib/auth/route-guard';
import { sendWhatsApp } from '@/lib/integrations/whatsapp';
import { sendSMS } from '@/lib/integrations/sms';
import { sendEmail } from '@/lib/integrations/email';
import { z } from 'zod';
import { escapeHtml } from '@/lib/security/sanitize';
import { createClient } from '@supabase/supabase-js';
import { generateId } from '@/lib/utils';
import { logger } from '@/lib/logger';

const SendMessageSchema = z.object({
  channel: z.enum(['whatsapp', 'sms', 'email']),
  to: z.string().max(255).optional(),
  subject: z.string().max(255).optional(),
  content: z.string().min(1).max(5000),
  leadName: z.string().max(200).optional(),
  conversationId: z.string().max(255).optional(),
  travelerId: z.string().uuid().optional(),
  inquiryId: z.string().uuid().optional(),
  legacyLeadId: z.string().max(255).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const guard = await guardRoute(request, { scope: 'messaging-send' });
    if (guard instanceof NextResponse) return guard;

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const validation = SendMessageSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: 'Invalid request.', details: validation.error.issues }, { status: 400 });
    }

    const { channel, to, subject, content, leadName, conversationId, travelerId, inquiryId, legacyLeadId } = validation.data;

    let result: { ok: boolean; error?: string };

    switch (channel) {
      case 'whatsapp':
        result = await sendWhatsApp(guard.tenantId, { to: to || '', body: content });
        break;
      case 'sms':
        result = await sendSMS(guard.tenantId, { to: to || '', body: content });
        break;
      case 'email':
        result = await sendEmail({
          tenantId: guard.tenantId,
          to: to || '',
          subject: subject || `Message from your travel specialist`,
          html: `<p>Hi ${escapeHtml(leadName || 'there')},</p><p>${escapeHtml(content).replace(/\n/g, '<br>')}</p>`,
        });
        break;
      default:
        return NextResponse.json({ error: 'Unknown channel' }, { status: 400 });
    }

    // Authoritative CRM Communication History
    if (result.ok) {
      try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (supabaseUrl && serviceKey) {
          const supabase = createClient(supabaseUrl, serviceKey);
          await supabase.from('activities').insert({
            id: `act-${generateId()}`,
            tenant_id: guard.tenantId,
            lead_id: legacyLeadId || null,
            traveler_id: travelerId || null,
            inquiry_id: inquiryId || null,
            user_id: guard.user?.id || null,
            user_name: guard.user?.fullName || 'Specialist',
            type: `${channel}_sent`,
            title: `${channel.toUpperCase()} sent: ${subject || (content.length > 30 ? content.slice(0, 30) + '...' : content)}`,
            description: content.length > 500 ? content.slice(0, 500) + '...' : content,
            created_at: new Date().toISOString(),
          });
        }
      } catch (historyErr) {
        logger.warn('Failed to record activity log for sent communication', { error: String(historyErr) });
      }
    }

    return NextResponse.json({
      ...result,
      conversationId,
      channel,
      simulated: !result.ok,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Message send failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
