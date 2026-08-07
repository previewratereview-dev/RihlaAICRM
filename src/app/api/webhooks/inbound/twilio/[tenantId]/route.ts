import { NextRequest, NextResponse } from 'next/server';
import { inngest } from '@/lib/inngest/client';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const formData = await request.formData();
    
    // Twilio sends data as form-urlencoded
    const from = formData.get('From') as string;
    const to = formData.get('To') as string;
    const body = formData.get('Body') as string;
    const messageSid = formData.get('MessageSid') as string;

    if (!from || !body) {
      return NextResponse.json({ error: 'Missing required Twilio parameters' }, { status: 400 });
    }

    // Determine if it's WhatsApp or SMS
    const isWhatsApp = from.startsWith('whatsapp:');
    const senderPhone = isWhatsApp ? from.replace('whatsapp:', '') : from;

    // Send to Inngest for Omnichannel processing
    await inngest.send({
      name: 'crm/message.received',
      data: {
        tenantId,
        provider: 'twilio',
        channel: isWhatsApp ? 'whatsapp' : 'sms',
        senderPhone,
        content: body,
        rawPayload: {
          messageSid,
          to
        }
      },
    });

    // Twilio expects TwiML or a 200 OK empty response
    return new NextResponse('OK', { status: 200 });
  } catch (error) {
    console.error('[Twilio Webhook] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
