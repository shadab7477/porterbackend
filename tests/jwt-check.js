import jwt from 'jsonwebtoken';

const secret = 'your_super_secret_jwt_key_here';
const customerToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY5Zjg2N2M1ZGIxMTdhMWE3NTFhNjAyNyIsInBob25lIjoiODMxOTMxOTE5MSIsInJvbGUiOiJjdXN0b21lciIsImlhdCI6MTc4MTI2NDU4MiwiZXhwIjoxODY3NTc4MTgyfQ.X15F9dh7kZUNl_ZbXhdTck5okKTG-I7XweP9U62kUWQ';
const driverToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjZhMmJkOWU4OTQwMmY5MzI3NmYwY2ZmZiIsInBob25lIjoiNzQ3NzI0NjQ3NyIsInR5cGUiOiJkcml2ZXJfYXV0aCIsInJvbGUiOiJkcml2ZXIiLCJpc1ZlcmlmaWVkIjp0cnVlLCJpYXQiOjE3ODEyNjQzNzAsImV4cCI6MTc8Mzg1NjM3MH0.inpD7ltM6rmeLls7ciwJ46EArL7wzlpKxy1o3p8N80o';

try {
  const customerDecoded = jwt.verify(customerToken, secret);
  console.log('✅ Customer token valid. Decoded:', customerDecoded);
} catch (error) {
  console.error('❌ Customer token invalid:', error.message);
}

try {
  const driverDecoded = jwt.verify(driverToken, secret);
  console.log('✅ Driver token valid. Decoded:', driverDecoded);
} catch (error) {
  console.error('❌ Driver token invalid:', error.message);
}
