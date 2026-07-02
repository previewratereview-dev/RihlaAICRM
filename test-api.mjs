import fetch from 'node-fetch';

async function test() {
  console.log('Testing create-order endpoint...');
  try {
    const res = await fetch('http://localhost:3000/api/billing/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'monthly' })
    });
    const text = await res.text();
    console.log('Status:', res.status);
    console.log('Body:', text);
  } catch (err) {
    console.error('Fetch error:', err);
  }
}

test();
