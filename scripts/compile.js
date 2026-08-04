const solc = require('solc');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'contracts', 'Susu.sol'), 'utf8');

const input = {
  language: 'Solidity',
  sources: { 'Susu.sol': { content: src } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
};

const out = JSON.parse(solc.compile(JSON.stringify(input)));

for (const e of out.errors || []) {
  console.log(e.severity.toUpperCase() + ':', e.formattedMessage.trim());
}
if ((out.errors || []).some((e) => e.severity === 'error')) process.exit(1);

const c = out.contracts['Susu.sol'].Susu;
fs.mkdirSync(path.join(__dirname, '..', 'build'), { recursive: true });
fs.writeFileSync(
  path.join(__dirname, '..', 'build', 'Susu.json'),
  JSON.stringify({ abi: c.abi, bytecode: '0x' + c.evm.bytecode.object }, null, 2),
);

console.log('compiled ok, solc', solc.version());
console.log('bytecode bytes:', c.evm.bytecode.object.length / 2);
