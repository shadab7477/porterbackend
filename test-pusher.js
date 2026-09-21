import dotenv from 'dotenv';
import { runAllTests } from './tests/pusherTest.js';

dotenv.config();

console.log('🚀 Starting Pusher Test Suite...\n');
console.log('Make sure your server is running with: npm start');
console.log('Press Ctrl+C to stop the tests\n');

// Run the tests
runAllTests().then((passed) => {
  if (passed) {
    console.log('✅ Test suite completed successfully!');
    process.exit(0);
  } else {
    console.log('❌ Test suite completed with failures!');
    process.exit(1);
  }
}).catch(error => {
  console.error('❌ Test suite failed with error:', error);
  process.exit(1);
});