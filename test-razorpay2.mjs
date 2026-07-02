import Razorpay from 'razorpay';
const razorpay = new Razorpay({
  key_id: 'rzp_test_T8GBZuZ956g2ui',
  key_secret: 'sQ7ylKg3hykCP1T8FGeXQfLL',
});
async function test() {
  try {
    const order = await razorpay.orders.create({
      amount: 49900,
      currency: 'INR',
      receipt: `rcpt_12345678_${Date.now()}`
    });
    console.log(JSON.stringify(order, null, 2));
  } catch (err) {
    console.error(err);
  }
}
test();
