const KEY_ROWS = [
  [
    { vk: 0xC0, label: '`', hand: 'left' },
    { vk: 0x31, label: '1', hand: 'left' },
    { vk: 0x32, label: '2', hand: 'left' },
    { vk: 0x33, label: '3', hand: 'left' },
    { vk: 0x34, label: '4', hand: 'left' },
    { vk: 0x35, label: '5', hand: 'left' },
    { vk: 0x36, label: '6', hand: 'right' },
    { vk: 0x37, label: '7', hand: 'right' },
    { vk: 0x38, label: '8', hand: 'right' },
    { vk: 0x39, label: '9', hand: 'right' },
    { vk: 0x30, label: '0', hand: 'right' },
    { vk: 0xBD, label: '-', hand: 'right' },
    { vk: 0xBB, label: '=', hand: 'right' },
    { vk: 0x08, label: '⌫', hand: 'right', grow: 1.5 }
  ],
  [
    { vk: 0x09, label: 'Tab', hand: 'left', grow: 1.5 },
    { vk: 0x51, label: 'Q', hand: 'left' },
    { vk: 0x57, label: 'W', hand: 'left' },
    { vk: 0x45, label: 'E', hand: 'left' },
    { vk: 0x52, label: 'R', hand: 'left' },
    { vk: 0x54, label: 'T', hand: 'left' },
    { vk: 0x59, label: 'Y', hand: 'right' },
    { vk: 0x55, label: 'U', hand: 'right' },
    { vk: 0x49, label: 'I', hand: 'right' },
    { vk: 0x4F, label: 'O', hand: 'right' },
    { vk: 0x50, label: 'P', hand: 'right' },
    { vk: 0xDB, label: '[', hand: 'right' },
    { vk: 0xDD, label: ']', hand: 'right' }
  ],
  [
    { vk: 0x14, label: 'Caps', hand: 'left', grow: 1.7 },
    { vk: 0x41, label: 'A', hand: 'left' },
    { vk: 0x53, label: 'S', hand: 'left' },
    { vk: 0x44, label: 'D', hand: 'left' },
    { vk: 0x46, label: 'F', hand: 'left', home: 'left' },
    { vk: 0x47, label: 'G', hand: 'left' },
    { vk: 0x48, label: 'H', hand: 'right' },
    { vk: 0x4A, label: 'J', hand: 'right', home: 'right' },
    { vk: 0x4B, label: 'K', hand: 'right' },
    { vk: 0x4C, label: 'L', hand: 'right' },
    { vk: 0xBA, label: ';', hand: 'right' },
    { vk: 0xDE, label: "'", hand: 'right' },
    { vk: 0x0D, label: 'Enter', hand: 'right', grow: 1.7 }
  ],
  [
    { vk: 0xA0, label: 'Shift', hand: 'left', grow: 2.2 },
    { vk: 0x5A, label: 'Z', hand: 'left' },
    { vk: 0x58, label: 'X', hand: 'left' },
    { vk: 0x43, label: 'C', hand: 'left' },
    { vk: 0x56, label: 'V', hand: 'left' },
    { vk: 0x42, label: 'B', hand: 'left' },
    { vk: 0x4E, label: 'N', hand: 'right' },
    { vk: 0x4D, label: 'M', hand: 'right' },
    { vk: 0xBC, label: ',', hand: 'right' },
    { vk: 0xBE, label: '.', hand: 'right' },
    { vk: 0xBF, label: '/', hand: 'right' },
    { vk: 0xA1, label: 'Shift', hand: 'right', grow: 2.2 }
  ],
  [
    { vk: 0xA2, label: 'Ctrl', hand: 'left', grow: 1.4 },
    { vk: 0xA4, label: 'Alt', hand: 'left', grow: 1.3 },
    { vk: 0x20, label: 'Space', hand: 'both', grow: 6 },
    { vk: 0xA5, label: 'Alt', hand: 'right', grow: 1.3 },
    { vk: 0xA3, label: 'Ctrl', hand: 'right', grow: 1.4 }
  ]
];

function allKeys() {
  return KEY_ROWS.flat();
}

module.exports = { KEY_ROWS, allKeys };
