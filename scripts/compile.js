const solc = require('solc');
const fs = require('fs');
const path = require('path');

const CONTRACTS = ['Susu.sol', 'SusuCircles.sol'];
const srcDir = path.join(__dirname, '..', 'contracts');
const outDir = path.join(__dirname, '..', 'build');

const sources = {};
for (const f of CONTRACTS) sources[f] = { content: fs.readFileSync(path.join(srcDir, f), 'utf8') };

const out = JSON.parse(
  solc.compile(
    JSON.stringify({
      language: 'Solidity',
      sources,
      settings: {
        optimizer: { enabled: true, runs: 200 },
        outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
      },
    }),
  ),
);

for (const e of out.errors || []) {
  console.log(e.severity.toUpperCase() + ':', e.formattedMessage.trim());
}
if ((out.errors || []).some((e) => e.severity === 'error')) process.exit(1);

fs.mkdirSync(outDir, { recursive: true });
for (const file of CONTRACTS) {
  const contractName = file.replace('.sol', '');
  const c = out.contracts[file][contractName];
  fs.writeFileSync(
    path.join(outDir, `${contractName}.json`),
    JSON.stringify({ abi: c.abi, bytecode: '0x' + c.evm.bytecode.object }, null, 2),
  );
  console.log(`${contractName.padEnd(12)} ${(c.evm.bytecode.object.length / 2).toString().padStart(6)} bytes`);
}

console.log('compiled ok, solc', solc.version());
