const b = require('bcryptjs');
const hash = '$2b$10$7tbVL1uXmfSe5ytUGD584OCPMFfelynzwV5DXcqJciLhZqd/6l3tK';
b.compare('1234', hash).then(r => console.log('Match:', r));