/** Historical helper name retained for existing test imports; both capture backends must run. */
export const linuxOnly: { skip?: boolean | string } = ['linux','win32'].includes(process.platform)
  ? {}
  : { skip: 'secured note capture currently supports Linux and Windows' };
