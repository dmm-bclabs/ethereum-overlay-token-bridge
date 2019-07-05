const Web3 = require('web3');
const EthereumTx = require('ethereumjs-tx');

const overlayTokenABI = require('./config/OverlayToken.json');
const setting = require('./config/setting.json');

const parent = setting['ropsten'].url;

const { ApiPromise, WsProvider } = require('@polkadot/api');
const { Keyring } = require('@polkadot/keyring');

const customTypes = {
  TokenBalance: "u128",
  ChildChainId: "u32"
};

async function main () {
  const child = 'ws://127.0.0.1:9944';
  const childApi = await ApiPromise.create({
    provider: new WsProvider(child),
    types: customTypes
  });
  // Constuct the keying after the API (crypto has an async init)
  const keyring = new Keyring({ type: 'sr25519' });
  // Add alice to our keyring with a hard-deived path (empty phrase, so uses dev)
  const owner = keyring.addFromUri('//Alice');
  
  let supplies = {
    child: {
      init: false,
      totalSupply: 0,
      localSupply: 0,
      parentSupply: 0,
    }
  }

  supplies.child.init = await childApi.query.token.init();
  supplies.child.totalSupply = await childApi.query.token.totalSupply();
  supplies.child.localSupply = await childApi.query.token.localSupply();
  supplies.child.parentSupply = await childApi.query.token.parentSupply();
  console.log(`init status on the child chain: ${supplies.child.init}`);
  console.log(`totalSupply on the child chain: ${supplies.child.totalSupply}`);
  console.log(`localSupply on the child chain: ${supplies.child.localSupply}`);
  console.log(`parentSupply on the child chain: ${supplies.child.parentSupply}`);

  const ParentProvider = new Web3(new Web3.providers.WebsocketProvider(parent));
  const OverlayToken = await new ParentProvider.eth.Contract(overlayTokenABI, setting['ropsten'].OverlayTokenAddress);

  console.log(setting['ropsten'].privateKey);
  const signer = ParentProvider.eth.accounts.privateKeyToAccount('0x' + setting['ropsten'].privateKey);
  console.log(signer.address);

  ParentProvider.eth.accounts.wallet.add(setting['ropsten'].privateKey)
  ParentProvider.eth.defaultAccount = signer.address;

  var totalSupply = await OverlayToken.methods.totalSupply().call();
  console.log(`Parent TotalSupply: ${totalSupply}`);

  childApi.query.token.init(async (init) => {
    supplies.child.init = init;
    if (supplies.child.init.valueOf()) {
      childApi.query.token.parentSupply(async (current) => {
        let change = current.sub(supplies.child.parentSupply);
        let local = await childApi.query.token.localSupply();
        let localChange = local.sub(supplies.child.localSupply);
        supplies.child.parentSupply = current;
        supplies.child.localSupply = local;
    
        // Detect send token child to parent
        if (!change.isZero() && !change.isNeg() && localChange.isNeg()) {
          console.log(`New childSupply on the parent chain: ${current}`);
          receiveFromChild(ParentProvider, OverlayToken, signer.address, change.toNumber());
        }
      })
    }
  });

  OverlayToken.events.allEvents({fromBlock: 'latest'}, function(error, result) {
    console.log('Watch event');
    if (!error) {
      switch(result.event) {
        case 'Mint':
          console.log('mint');
          console.log(result.returnValues.value.toNumber());
          // mint token
          mintToken(childApi, owner, result.returnValues.value.toNumber());
          break;
        case 'Burn':
          console.log('burn');
          console.log(result.returnValues.value.toNumber());
          burnToken(childApi, owner, result.returnValues.value.toNumber());
          break;
        case 'Send':
          console.log('send');
          console.log(result.returnValues.value.toNumber());
          receiveFromParent(childApi, owner, result.returnValues.value.toNumber());
          break;
        default:
          break;
      }
    }
  });
}

async function mintToken(api, owner, value) {
  const tx = api.tx.token.mint(value);
  const hash = await tx.signAndSend(owner);

  console.log('=== mint token ===');
  console.log(`Mint ${value} token with hash: ${hash.toHex()}`);
  console.log('');
}

async function burnToken(api, owner, value) {
  const tx = api.tx.token.burn(value);
  const hash = await tx.signAndSend(owner);

  console.log('=== burn token ===');
  console.log(`Burn ${value} token with hash: ${hash.toHex()}`);
  console.log('');
}

async function receiveFromParent(api, sender, value) {
  const tx = api.tx.token.receiveFromParent(value);
  const hash = await tx.signAndSend(sender);

  console.log('=== send receive from parent ===');
  console.log(`Receive ${value} token from parent with hash: ${hash.toHex()}`);
  console.log('');
}

async function receiveFromChild(web3, contract, address, value) {
  try {
    const data = await contract.methods.receiveFromChild(0, value).encodeABI();
    console.log(data);
    const nonce = await web3.eth.getTransactionCount(address, 'pending');
    console.log(nonce);
    const stx = await signTransaction({
      to: setting['ropsten'].OverlayTokenAddress,
      value: 0,
      data: data,
      gasLimit: web3.utils.toHex(60000),
      gasPrice: web3.utils.toHex(20 * 100000000),
      nonce: nonce,
      chainId: setting['ropsten'].chainId
    },
    setting['ropsten'].privateKey);
    console.log(stx);
    await web3.eth.sendSignedTransaction(stx, (err, hash) => {
      if (err) {
        throw err;
      }
      console.log('=== send receive from child ===');
      console.log(`Receive ${value} token from child with hash of ${hash}`);
      console.log('');
    });
  } catch(err) {
    throw err;
  }
}

async function signTransaction(args, privateKey) {
  const unsignedTransaction = new EthereumTx(args);
  unsignedTransaction.sign(Buffer.from(privateKey, "hex"));
  const stx = unsignedTransaction.serialize();
  return `0x${stx.toString("hex")}`;
}

main().catch(console.error);
