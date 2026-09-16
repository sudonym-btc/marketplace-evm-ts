// Generated from boltz-core by scripts/generate-boltz-abi.mjs. Do not edit.
export const erc20SwapAbi = [
  {
    "type": "event",
    "name": "Lockup",
    "inputs": [
      {
        "name": "preimageHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "tokenAddress",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "claimAddress",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "refundAddress",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "timelock",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "function",
    "name": "claim",
    "inputs": [
      {
        "name": "preimage",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "tokenAddress",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "refundAddress",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "timelock",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "lock",
    "inputs": [
      {
        "name": "preimageHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "tokenAddress",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "claimAddress",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "timelock",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "refund",
    "inputs": [
      {
        "name": "preimageHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "tokenAddress",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "claimAddress",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "timelock",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "refundCooperative",
    "inputs": [
      {
        "name": "preimageHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "tokenAddress",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "claimAddress",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "timelock",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "v",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "r",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "s",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  }
] as const
