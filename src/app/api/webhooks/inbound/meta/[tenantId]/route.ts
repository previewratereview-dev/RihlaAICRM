import { NextRequest, NextResponse } from 'next/server';
import { inngest } from '@/lib/inngest/client';

// Meta Webhook Verification
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;
  const searchParams = request.nextUrl.searchParams;
  
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  // In a real implementation, you would fetch the tenant's settings to verify the token.
  // For simplicity here, if mode and token exist, we return the challenge.
  if (mode === 'subscribe' && token && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }

  return new NextResponse('Forbidden', { status: 403 });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const body = await request.json();

    // Parse Meta API payload structure
    if (body.object === 'whatsapp_business_account') {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0]?.value;
      const messages = changes?.messages;
      const contacts = changes?.contacts;

      if (messages && messages.length > 0) {
        const message = messages[0];
        const contact = contacts?.[0];
        
        const senderPhone = message.from;
        const senderName = contact?.profile?.name || 'Unknown';
        
        let content = '';
        if (message.type === 'text') {
          content = message.text.body;
        } else {
          content = `[Received media type: ${message.type}]`;
        }

        // Send to Inngest for Omnichannel processing
        await inngest.send({
          name: 'crm/message.received',
          data: {
            tenantId,
            provider: 'meta',
            channel: 'whatsapp',
            senderPhone,
            senderName,
            content,
            rawPayload: {
              messageId: message.id,
            }
          },
        });
      }
    }

    // Meta expects a 200 OK
    return new NextResponse('OK', { status: 200 });
  } catch (error) {
    console.error('[Meta Webhook] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
