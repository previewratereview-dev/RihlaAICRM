import { NextResponse } from 'next/server';
import { RegisterSchema, validateRequest } from '@/lib/validation/schemas';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const validation = validateRequest(RegisterSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.errors[0] }, { status: 400 });
    }

    const { fullName, email, password, agencyName } = validation.data;

    const isLocalMode = !process.env.NEXT_PUBLIC_SUPABASE_URL;

    if (isLocalMode) {
      const tenantId = `tenant-${Date.now()}`;
      const userId = `user-${Date.now()}`;

      return NextResponse.json({
        success: true,
        userId,
        tenantId,
      });
    }

    const { register } = await import('@/lib/registration/service');
    const result = await register({ email, password, agencyName, clientSource: 'web' });

    if (!result.ok) {
      return NextResponse.json({ error: result.error?.message || 'Registration failed.' }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      userId: result.userId,
      tenantId: result.tenantId,
      token: result.token,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Registration failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
