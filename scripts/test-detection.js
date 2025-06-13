#!/usr/bin/env node

import { detectLibzstdIssue } from './mac-libzstd-fix.js';

console.log('🧪 Testing libzstd detection logic...\n');

try {
  const hasIssue = await detectLibzstdIssue();
  
  console.log('\n📊 Detection Result:');
  console.log(`   Has libzstd issue: ${hasIssue}`);
  
  if (hasIssue) {
    console.log('\n✅ Detection working - issue found, automatic fix should trigger');
  } else {
    console.log('\n❓ No issue detected - either:');
    console.log('   • No embedded postgres binary found');
    console.log('   • Binary works fine (no libzstd issue)');
    console.log('   • Different type of error (not libzstd related)');
  }
  
} catch (error) {
  console.error('❌ Detection test failed:', error.message);
  process.exit(1);
}

console.log('\n🏁 Detection test complete!'); 