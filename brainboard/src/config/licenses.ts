/*
 * licenses.ts — GENERATED FILE, DO NOT EDIT BY HAND.
 *
 * Regenerate with:  node scripts/gen-licenses.mjs
 *
 * Third-party packages bundled into the shipped app, with the copyright
 * notices their licenses require us to reproduce. Dev-only tooling (Vite,
 * TypeScript, ESLint) is omitted — it never reaches the bundle — as are
 * type-only packages.
 *
 * Generated 2026-08-15 against package-lock.json.
 */

export type LicenseId = 'OFL-1.1' | 'MIT'

export interface ThirdPartyPackage {
  /** npm package name. */
  name:      string
  /** Version resolved in package-lock.json at generation time. */
  version:   string
  license:   LicenseId
  /** Verbatim copyright line from the package's LICENSE file. */
  copyright: string
  url:       string
  /** true for packages listed in our own package.json dependencies. */
  direct:    boolean
}

export const THIRD_PARTY: ThirdPartyPackage[] = [
  {
    name: "@fontsource-variable/fraunces",
    version: "5.2.9",
    license: "OFL-1.1",
    copyright: "Copyright 2020 The Fraunces Project Authors (github.com/undercasetype/Fraunces)",
    url: "https://github.com/fontsource/font-files",
    direct: true
  },
  {
    name: "@fontsource-variable/inter",
    version: "5.2.8",
    license: "OFL-1.1",
    copyright: "Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)",
    url: "https://github.com/fontsource/font-files",
    direct: true
  },
  {
    name: "marked",
    version: "18.0.2",
    license: "MIT",
    copyright: "Copyright (c) 2018+, MarkedJS (https://github.com/markedjs/)\nCopyright (c) 2011-2018, Christopher Jeffrey (https://github.com/chjj/)\nCopyright © 2004, John Gruber",
    url: "https://github.com/markedjs/marked",
    direct: true
  },
  {
    name: "nanoid",
    version: "5.1.16",
    license: "MIT",
    copyright: "Copyright 2017 Andrey Sitnik <andrey@sitnik.es>",
    url: "https://github.com/ai/nanoid",
    direct: true
  },
  {
    name: "react",
    version: "19.2.5",
    license: "MIT",
    copyright: "Copyright (c) Meta Platforms, Inc. and affiliates.",
    url: "https://github.com/facebook/react",
    direct: true
  },
  {
    name: "react-dom",
    version: "19.2.5",
    license: "MIT",
    copyright: "Copyright (c) Meta Platforms, Inc. and affiliates.",
    url: "https://github.com/facebook/react",
    direct: true
  },
  {
    name: "react-moveable",
    version: "0.56.0",
    license: "MIT",
    copyright: "Copyright (c) 2019 Daybrush",
    url: "https://github.com/daybrush/moveable/blob/master/packages/react-moveable",
    direct: true
  },
  {
    name: "react-selecto",
    version: "1.26.3",
    license: "MIT",
    copyright: "Copyright (c) 2020 Daybrush",
    url: "https://github.com/daybrush/selecto/blob/master/packages/react-selecto",
    direct: true
  },
  {
    name: "zustand",
    version: "5.0.12",
    license: "MIT",
    copyright: "Copyright (c) 2019 Paul Henschel",
    url: "https://github.com/pmndrs/zustand",
    direct: true
  },
  {
    name: "@cfcs/core",
    version: "0.0.6",
    license: "MIT",
    copyright: "Copyright (c) NAVER Crop.",
    url: "https://github.com/naver/cfcs",
    direct: false
  },
  {
    name: "@daybrush/utils",
    version: "1.13.0",
    license: "MIT",
    copyright: "Copyright (c) 2018 Daybrush",
    url: "https://github.com/daybrush/utils",
    direct: false
  },
  {
    name: "@egjs/agent",
    version: "2.4.4",
    license: "MIT",
    copyright: "Copyright (c) 2015 NAVER Corp.",
    url: "https://github.com/naver/egjs-agent",
    direct: false
  },
  {
    name: "@egjs/children-differ",
    version: "1.0.1",
    license: "MIT",
    copyright: "Copyright (c) 2019-present NAVER Corp.",
    url: "https://github.com/naver/egjs-children-differ",
    direct: false
  },
  {
    name: "@egjs/component",
    version: "3.0.5",
    license: "MIT",
    copyright: "Copyright (c) NAVER Corp.",
    url: "https://github.com/naver/egjs-component",
    direct: false
  },
  {
    name: "@egjs/list-differ",
    version: "1.0.1",
    license: "MIT",
    copyright: "Copyright (c) 2019-present NAVER Corp.",
    url: "https://github.com/naver/egjs-list-differ",
    direct: false
  },
  {
    name: "@scena/dragscroll",
    version: "1.4.0",
    license: "MIT",
    copyright: "Copyright (c) 2019 Daybrush",
    url: "https://github.com/daybrush/dragscroll",
    direct: false
  },
  {
    name: "@scena/event-emitter",
    version: "1.0.5",
    license: "MIT",
    copyright: "Copyright (c) 2019 Daybrush",
    url: "https://github.com/daybrush/gesture",
    direct: false
  },
  {
    name: "@scena/matrix",
    version: "1.1.1",
    license: "MIT",
    copyright: "Copyright (c) 2020 Daybrush",
    url: "https://github.com/daybrush/matrix",
    direct: false
  },
  {
    name: "css-styled",
    version: "1.0.8",
    license: "MIT",
    copyright: "Copyright (c) Daybrush",
    url: "https://github.com/daybrush/css-styled",
    direct: false
  },
  {
    name: "css-to-mat",
    version: "1.1.1",
    license: "MIT",
    copyright: "Copyright (c) 2019 Daybrush",
    url: "https://github.com/daybrush/css-to-mat",
    direct: false
  },
  {
    name: "framework-utils",
    version: "1.1.0",
    license: "MIT",
    copyright: "Copyright (c) 2019 Daybrush",
    url: "https://github.com/daybrush/framework-utils",
    direct: false
  },
  {
    name: "gesto",
    version: "1.19.4",
    license: "MIT",
    copyright: "Copyright (c) 2019 Daybrush",
    url: "https://github.com/daybrush/gesto",
    direct: false
  },
  {
    name: "keycode",
    version: "2.2.1",
    license: "MIT",
    copyright: "Copyright (c) 2014 Tim Oxley",
    url: "https://github.com/timoxley/keycode",
    direct: false
  },
  {
    name: "keycon",
    version: "1.4.0",
    license: "MIT",
    copyright: "Copyright (c) Daybrush",
    url: "https://github.com/daybrush/keycon",
    direct: false
  },
  {
    name: "overlap-area",
    version: "1.1.0",
    license: "MIT",
    copyright: "Copyright (c) 2020 Daybrush",
    url: "https://github.com/daybrush/overlap-area",
    direct: false
  },
  {
    name: "react-css-styled",
    version: "1.1.9",
    license: "MIT",
    copyright: "Copyright (c) 2019 Daybrush",
    url: "https://github.com/daybrush/css-styled/tree/master/packages/react-css-styled",
    direct: false
  },
  {
    name: "scheduler",
    version: "0.27.0",
    license: "MIT",
    copyright: "Copyright (c) Meta Platforms, Inc. and affiliates.",
    url: "https://github.com/facebook/react",
    direct: false
  },
  {
    name: "selecto",
    version: "1.26.3",
    license: "MIT",
    copyright: "Copyright (c) 2020 Daybrush",
    url: "https://github.com/daybrush/selecto",
    direct: false
  }
]

/**
 * License bodies, stored once and paired with each package's own copyright
 * line at render time. Both MIT and OFL-1.1 require the notice and the
 * license text to travel with the distributed work.
 */
export const LICENSE_TEXTS: Record<LicenseId, string> = {
  'MIT': "Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the \"Software\"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.",
  'OFL-1.1': "-----------------------------------------------------------\nSIL OPEN FONT LICENSE Version 1.1 - 26 February 2007\n-----------------------------------------------------------\n\nPREAMBLE\nThe goals of the Open Font License (OFL) are to stimulate worldwide\ndevelopment of collaborative font projects, to support the font creation\nefforts of academic and linguistic communities, and to provide a free and\nopen framework in which fonts may be shared and improved in partnership\nwith others.\n\nThe OFL allows the licensed fonts to be used, studied, modified and\nredistributed freely as long as they are not sold by themselves. The\nfonts, including any derivative works, can be bundled, embedded,\nredistributed and/or sold with any software provided that any reserved\nnames are not used by derivative works. The fonts and derivatives,\nhowever, cannot be released under any other type of license. The\nrequirement for fonts to remain under this license does not apply\nto any document created using the fonts or their derivatives.\n\nDEFINITIONS\n\"Font Software\" refers to the set of files released by the Copyright\nHolder(s) under this license and clearly marked as such. This may\ninclude source files, build scripts and documentation.\n\n\"Reserved Font Name\" refers to any names specified as such after the\ncopyright statement(s).\n\n\"Original Version\" refers to the collection of Font Software components as\ndistributed by the Copyright Holder(s).\n\n\"Modified Version\" refers to any derivative made by adding to, deleting,\nor substituting -- in part or in whole -- any of the components of the\nOriginal Version, by changing formats or by porting the Font Software to a\nnew environment.\n\n\"Author\" refers to any designer, engineer, programmer, technical\nwriter or other person who contributed to the Font Software.\n\nPERMISSION & CONDITIONS\nPermission is hereby granted, free of charge, to any person obtaining\na copy of the Font Software, to use, study, copy, merge, embed, modify,\nredistribute, and sell modified and unmodified copies of the Font\nSoftware, subject to the following conditions:\n\n1) Neither the Font Software nor any of its individual components,\nin Original or Modified Versions, may be sold by itself.\n\n2) Original or Modified Versions of the Font Software may be bundled,\nredistributed and/or sold with any software, provided that each copy\ncontains the above copyright notice and this license. These can be\nincluded either as stand-alone text files, human-readable headers or\nin the appropriate machine-readable metadata fields within text or\nbinary files as long as those fields can be easily viewed by the user.\n\n3) No Modified Version of the Font Software may use the Reserved Font\nName(s) unless explicit written permission is granted by the corresponding\nCopyright Holder. This restriction only applies to the primary font name as\npresented to the users.\n\n4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font\nSoftware shall not be used to promote, endorse or advertise any\nModified Version, except to acknowledge the contribution(s) of the\nCopyright Holder(s) and the Author(s) or with their explicit written\npermission.\n\n5) The Font Software, modified or unmodified, in part or in whole,\nmust be distributed entirely under this license, and must not be\ndistributed under any other license. The requirement for fonts to\nremain under this license does not apply to any document created\nusing the Font Software.\n\nTERMINATION\nThis license becomes null and void if any of the above conditions are\nnot met.\n\nDISCLAIMER\nTHE FONT SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND,\nEXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF\nMERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT\nOF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE\nCOPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,\nINCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL\nDAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING\nFROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM\nOTHER DEALINGS IN THE FONT SOFTWARE.",
}

export const LICENSE_NAMES: Record<LicenseId, string> = {
  'MIT': 'MIT License',
  'OFL-1.1': 'SIL Open Font License 1.1',
}
