const Web3 = require('web3');
const EthereumTx = require('ethereumjs-tx');

const overlayTokenABI = require('./config/OverlayToken.json');
const setting = require('./config/setting.json');

const { ApiPromise, WsProvider } = require('@polkadot/api');
const { Keyring } = require('@polkadot/keyring');

const customTypes = {
  TokenBalance: "u128",
  ChildChainId: "u32"
};

async function main () {

  const child = process.env.CHILD || 'ws://127.0.0.1:9944';
  const chain = process.env.CHAIN || 'ropsten';
  const parent = setting[chain].url;

  const childApi = await ApiPromise.create({
    provider: new WsProvider(child),
    types: customTypes
  });
  // Constuct the keying after the API (crypto has an async init)
  const keyring = new Keyring({ type: 'sr25519' });
  // Add alice to our keyring with a hard-deived path (empty phrase, so uses dev)
  const childSigner = keyring.addFromUri('//Alice');
  
  const ParentProvider = new Web3(new Web3.providers.WebsocketProvider(parent));
  const OverlayToken = await new ParentProvider.eth.Contract(overlayTokenABI, setting[chain].OverlayTokenAddress);

  console.log(setting[chain].privateKey);
  const parentSigner = ParentProvider.eth.accounts.privateKeyToAccount('0x' + setting[chain].privateKey);
  console.log(parentSigner.address);

  ParentProvider.eth.accounts.wallet.add(setting[chain].privateKey)
  ParentProvider.eth.defaultAccount = parentSigner.address;

  var totalSupply = await OverlayToken.methods.totalSupply().call();
  console.log(`Parent TotalSupply: ${totalSupply}`);

  childApi.query.token.init(async (init) => {
    if (init.valueOf()) {
      syncTokenStatus(ParentProvider, OverlayToken, childApi, parentSigner, childSigner);
    }
  });
}

function syncTokenStatus(parentApi, parentContract, childApi, parentSigner, childSigner) {
  syncTokenStatus = function() {};
  console.log("watch start");

  // watch parent
  parentContract.events.allEvents({fromBlock: 'latest'}, function(error, result) {
    if (!error) {
      switch(result.event) {
        case 'Mint':
          console.log('mint');
          console.log(result);
          console.log(result.returnValues.value.toNumber());
          // mint token
          // mintToken(childApi, childSigner, result.returnValues.value.toNumber());
          break;
        case 'Burn':
          console.log('burn');
          console.log(result.returnValues.value.toNumber());
          burnToken(childApi, childSigner, result.returnValues.value.toNumber());
          break;
        case 'Send':
          console.log('send');
          console.log(result.returnValues.value.toNumber());
          receiveFromParent(childApi, childSigner, result.returnValues.value.toNumber());
          break;
        default:
          break;
      }
    }
  });

  // watch child
  childApi.query.system.events((events) => {
    // loop through the Vec<EventRecord>
    events.forEach((record) => {
      // extract the phase, event and the event types
      const { event, phase } = record;
      const types = event.typeDef;

      switch(`${event.section}:${event.method}`) {
        case 'token:SentToParent':
          console.log('Child: SentToParent');
          console.log(`Address: ${event.data[0]}`);
          console.log(`Amount: ${event.data[1]}`);
          receiveFromChild(parentApi, parentContract, parentSigner.address, event.data[1].toNumber());
          break;
      default:
        break;
      }
    });
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
      to: setting[chain].OverlayTokenAddress,
      value: 0,
      data: data,
      gasLimit: web3.utils.toHex(60000),
      gasPrice: web3.utils.toHex(20 * 1000000000 /* Gwei */),
      nonce: nonce,
      chainId: setting[chain].chainId
    },
    setting[chain].privateKey);
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
