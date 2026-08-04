require('@nomicfoundation/hardhat-ethers');
require('@nomicfoundation/hardhat-chai-matchers');

/** Matches what we deployed to Sepolia, so tests exercise the same bytecode. */
module.exports = {
  solidity: {
    version: '0.8.28',
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  paths: { sources: './contracts', tests: './test', cache: './.hhcache', artifacts: './.hhartifacts' },
};
