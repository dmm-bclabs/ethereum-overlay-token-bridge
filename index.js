const Web3 = require('web3');
const request = require('superagent');

const overlayTokenABI = require('./config/OverlayToken.json');
const setting = require('./config/setting.json');

const parent = setting['ropsten'].url;

async function main () {
  // TODO: use wss://
  const ParentProvider = new Web3(new Web3.providers.HttpProvider('https://' + parent));
  const OverlayToken = await new ParentProvider.eth.Contract(overlayTokenABI, setting['ropsten'].OverlayTokenAddress);

  var totalSupply = await OverlayToken.methods.totalSupply().call();
  var owner = await OverlayToken.methods.owner().call();
  console.log(`TotalSupply: ${totalSupply}`);
  console.log(`Owner: ${owner}`);
}

main().catch(console.error);


