import { sendSmsOtp, generateOTP } from './utils/smsService.js';

const otp = generateOTP();
const result = await sendSmsOtp('7477246477', otp);
console.log('Final result:', result);