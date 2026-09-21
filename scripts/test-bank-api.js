import { getCustomerBankDetails, updateCustomerBankDetails, deleteCustomerBankDetails } from '../controllers/walletController.js';

console.log('✅ getCustomerBankDetails function type:', typeof getCustomerBankDetails);
console.log('✅ updateCustomerBankDetails function type:', typeof updateCustomerBankDetails);
console.log('✅ deleteCustomerBankDetails function type:', typeof deleteCustomerBankDetails);

if (typeof getCustomerBankDetails === 'function' && typeof updateCustomerBankDetails === 'function' && typeof deleteCustomerBankDetails === 'function') {
  console.log('🎉 All bank details controller methods successfully exported and loaded!');
} else {
  console.error('❌ Failed to load controller methods');
  process.exit(1);
}
