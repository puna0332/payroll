/**
 * Real employee data synced from Lark Admin (2026-05-29)
 * Auto-generated from scripts/sync-lark-employees.mjs
 */

export interface LarkDepartment {
  id: string;
  name: string;
  parentId: string;
  memberCount: number;
}

export interface LarkEmployee {
  openId: string;
  userId: string;
  name: string;
  enName: string;
  email: string;
  enterpriseEmail: string;
  mobile: string;
  gender: number; // 0=Unknown, 1=Male, 2=Female
  avatarUrl: string;
  employeeNo: string;
  employeeType: number; // 1=Regular, 2=Intern, 3=Outsource, 4=Contractor, 5=Consultant
  jobTitle: string;
  joinTime: number; // unix seconds
  isActivated: boolean;
  isResigned: boolean;
  isFrozen: boolean;
  departmentIds: string[];
  leaderUserId?: string;
}

// ─── Department Map ─────────────────────────────────────────

export const DEPARTMENTS: LarkDepartment[] = [
  { id: 'od-a2d5d0b79670cf236ab76b126ad153ff', name: 'BPQL管理部', parentId: '0', memberCount: 3 },
  { id: 'od-74e0ab780ef9809113877989dbb0c9f5', name: 'TB&GP機材部', parentId: '0', memberCount: 12 },
  { id: 'od-2601c558f083058bfb94e9c0999dd1d5', name: 'BOD', parentId: '0', memberCount: 2 },
  { id: 'od-a357c7d2e3b11b0413f88c8b1869349e', name: 'PKD&TVTK営業部', parentId: 'od-74e0ab780ef9809113877989dbb0c9f5', memberCount: 4 },
  { id: 'od-99928b44cfb00523000e1bd401b3717f', name: 'TTVT機材センター', parentId: 'od-74e0ab780ef9809113877989dbb0c9f5', memberCount: 7 },
  { id: 'od-111b2cf1febbdb39c3882ea3ea6300b1', name: 'Worker', parentId: 'od-99928b44cfb00523000e1bd401b3717f', memberCount: 5 },
  { id: 'od-0beae804da4601162fd550fc7a4caedd', name: 'UpBase Test', parentId: 'od-99928b44cfb00523000e1bd401b3717f', memberCount: 1 },
];

export const DEPT_MAP = Object.fromEntries(DEPARTMENTS.map(d => [d.id, d.name]));

// ─── Employees ──────────────────────────────────────────────

export const EMPLOYEES: LarkEmployee[] = [
  {
    openId: 'ou_3859ecdd2e90a1544e92a68b6db0e1d8',
    userId: 'ASV003',
    name: 'Tram',
    enName: 'Tram',
    email: 'tram-n@asnovavn.com',
    enterpriseEmail: 'tram-n@asnovavn.com',
    mobile: '',
    gender: 0,
    avatarUrl: 'https://s16-imfile-sg.feishucdn.com/static-resource/v1/v3_00j8_24bfb112-db1c-460d-9e1c-b62635fdd4hu~?image_size=240x240&cut_type=&quality=&format=png&sticker_format=.webp',
    employeeNo: '',
    employeeType: 1,
    jobTitle: '',
    joinTime: 1660521600,
    isActivated: true,
    isResigned: false,
    isFrozen: false,
    departmentIds: ['od-a2d5d0b79670cf236ab76b126ad153ff'],
    leaderUserId: 'ou_de12369023e34e63a3b829ab3c1ebead',
  },
  {
    openId: 'ou_de12369023e34e63a3b829ab3c1ebead',
    userId: 'ASV002',
    name: 'Tran',
    enName: '',
    email: 'tran-b@asnovavn.com',
    enterpriseEmail: 'tran-b@asnovavn.com',
    mobile: '',
    gender: 0,
    avatarUrl: 'https://s16-imfile-sg.feishucdn.com/static-resource/v1/v3_00ik_894358be-352a-436b-a4a9-39c213e11fhu~?image_size=240x240&cut_type=&quality=&format=png&sticker_format=.webp',
    employeeNo: '',
    employeeType: 1,
    jobTitle: '',
    joinTime: 1660521600,
    isActivated: true,
    isResigned: false,
    isFrozen: false,
    departmentIds: ['od-a2d5d0b79670cf236ab76b126ad153ff'],
    leaderUserId: 'ou_969e5276321a2540ae938b6b80cb8781',
  },
  {
    openId: 'ou_24959da2cf545f3e7cb44aadb585bae8',
    userId: 'ASV014',
    name: 'Nguyễn Thị Thu Trang',
    enName: '',
    email: 'trang-t@asnovavn.com',
    enterpriseEmail: 'trang-t@asnovavn.com',
    mobile: '',
    gender: 0,
    avatarUrl: 'https://s16-imfile-sg.feishucdn.com/static-resource/v1/v3_00oe_60872713-bd34-48ff-a3bb-539edbfd5dhu~?image_size=240x240&cut_type=&quality=&format=png&sticker_format=.webp',
    employeeNo: '',
    employeeType: 1,
    jobTitle: '',
    joinTime: 1687737600,
    isActivated: true,
    isResigned: false,
    isFrozen: false,
    departmentIds: ['od-a2d5d0b79670cf236ab76b126ad153ff'],
    leaderUserId: 'ou_de12369023e34e63a3b829ab3c1ebead',
  },
  {
    openId: 'ou_5c524201f331274b527b1e1915984758',
    userId: 'ASV001',
    name: 'KIIICHIROTANAKA',
    enName: '',
    email: 'k-tanaka@asnovavn.com',
    enterpriseEmail: 'k-tanaka@asnovavn.com',
    mobile: '',
    gender: 0,
    avatarUrl: 'https://s16-imfile-sg.feishucdn.com/static-resource/v1/v3_00uh_0976f814-86cd-4158-abd3-d81b9d758chu~?image_size=240x240&cut_type=&quality=&format=png&sticker_format=.webp',
    employeeNo: '',
    employeeType: 1,
    jobTitle: '',
    joinTime: 1660521600,
    isActivated: true,
    isResigned: false,
    isFrozen: false,
    departmentIds: ['od-2601c558f083058bfb94e9c0999dd1d5', 'od-74e0ab780ef9809113877989dbb0c9f5'],
  },
  {
    openId: 'ou_969e5276321a2540ae938b6b80cb8781',
    userId: 'ASV013',
    name: 'Hoshihara',
    enName: '',
    email: 's-hoshihara@asnovavn.com',
    enterpriseEmail: 's-hoshihara@asnovavn.com',
    mobile: '',
    gender: 0,
    avatarUrl: 'https://s16-imfile-sg.feishucdn.com/static-resource/v1/v3_00vp_827c473c-7f9b-4252-bf6a-6dbf1a0d9fhu~?image_size=240x240&cut_type=&quality=&format=png&sticker_format=.webp',
    employeeNo: '',
    employeeType: 1,
    jobTitle: '',
    joinTime: 1685577600,
    isActivated: true,
    isResigned: false,
    isFrozen: false,
    departmentIds: ['od-2601c558f083058bfb94e9c0999dd1d5'],
    leaderUserId: 'ou_5c524201f331274b527b1e1915984758',
  },
  {
    openId: 'ou_cc3bd1fe7cd79b1155af78f1f0fe17cf',
    userId: 'ASV010',
    name: 'Hải',
    enName: '',
    email: 'hai-v@asnovavn.com',
    enterpriseEmail: 'hai-v@asnovavn.com',
    mobile: '',
    gender: 0,
    avatarUrl: 'https://s16-imfile-sg.feishucdn.com/static-resource/v1/v3_00j8_a6d7b106-7fe6-4165-b0ae-3ca9d03938hu~?image_size=240x240&cut_type=&quality=&format=png&sticker_format=.webp',
    employeeNo: '',
    employeeType: 1,
    jobTitle: '',
    joinTime: 1681171200,
    isActivated: true,
    isResigned: false,
    isFrozen: false,
    departmentIds: ['od-a357c7d2e3b11b0413f88c8b1869349e'],
    leaderUserId: 'ou_5c524201f331274b527b1e1915984758',
  },
  {
    openId: 'ou_f214f3b61cb16c06e7a6e24896dcd981',
    userId: 'ASV011',
    name: 'Nguyễn Văn Cảnh',
    enName: '',
    email: 'canh-v@asnovavn.com',
    enterpriseEmail: 'canh-v@asnovavn.com',
    mobile: '',
    gender: 0,
    avatarUrl: 'https://s16-imfile-sg.feishucdn.com/static-resource/v1/v3_00jj_0d025e7f-6e00-41f3-b634-a21b9fcec7hu~?image_size=240x240&cut_type=&quality=&format=png&sticker_format=.webp',
    employeeNo: '',
    employeeType: 1,
    jobTitle: '',
    joinTime: 1681171200,
    isActivated: true,
    isResigned: false,
    isFrozen: false,
    departmentIds: ['od-a357c7d2e3b11b0413f88c8b1869349e'],
    leaderUserId: 'ou_cc3bd1fe7cd79b1155af78f1f0fe17cf',
  },
  {
    openId: 'ou_4e5bc029f704e86b7faace95e479f783',
    userId: 'ASV022',
    name: 'Văn Hậu',
    enName: '',
    email: 'hau-v@asnovavn.com',
    enterpriseEmail: 'hau-v@asnovavn.com',
    mobile: '+84979774565',
    gender: 1,
    avatarUrl: 'https://s16-imfile-sg.feishucdn.com/static-resource/v1/v3_00sd_73d14ed2-c0bb-4873-9277-1352835ce9hu~?image_size=240x240&cut_type=&quality=&format=png&sticker_format=.webp',
    employeeNo: 'ASV022',
    employeeType: 1,
    jobTitle: '',
    joinTime: 1747612800,
    isActivated: true,
    isResigned: false,
    isFrozen: false,
    departmentIds: ['od-a357c7d2e3b11b0413f88c8b1869349e'],
    leaderUserId: 'ou_cc3bd1fe7cd79b1155af78f1f0fe17cf',
  },
  {
    openId: 'ou_237f6cb2c19f65dc6174194676d22778',
    userId: 'db25735a',
    name: 'Dương Văn Sử',
    enName: '',
    email: 'su-v@asnovavn.com',
    enterpriseEmail: 'su-v@asnovavn.com',
    mobile: '+84842735484',
    gender: 1,
    avatarUrl: 'https://s16-imfile-sg.feishucdn.com/static-resource/v1/v3_00vf_576604cf-2490-441e-8636-9c97cbb89bhu~?image_size=240x240&cut_type=&quality=&format=png&sticker_format=.webp',
    employeeNo: 'ASV024',
    employeeType: 1,
    jobTitle: '',
    joinTime: 1772582400,
    isActivated: true,
    isResigned: false,
    isFrozen: false,
    departmentIds: ['od-a357c7d2e3b11b0413f88c8b1869349e'],
  },
  {
    openId: 'ou_fd1acd947ba0173370c5426e1b35af06',
    userId: 'ASV005',
    name: 'Tai',
    enName: '',
    email: 'tai-x@asnovavn.com',
    enterpriseEmail: 'tai-x@asnovavn.com',
    mobile: '',
    gender: 0,
    avatarUrl: 'https://s16-imfile-sg.feishucdn.com/static-resource/v1/v3_00j8_58c60b69-13bf-406f-aa32-62d14a73dchu~?image_size=240x240&cut_type=&quality=&format=png&sticker_format=.webp',
    employeeNo: '',
    employeeType: 1,
    jobTitle: '',
    joinTime: 1660521600,
    isActivated: true,
    isResigned: false,
    isFrozen: false,
    departmentIds: ['od-99928b44cfb00523000e1bd401b3717f'],
    leaderUserId: 'ou_5c524201f331274b527b1e1915984758',
  },
  {
    openId: 'ou_91103b2d6e949ee5745af6b987fe2c2b',
    userId: 'ASV0017',
    name: 'Hà Minh Châu',
    enName: '',
    email: '',
    mobile: '+84984495535',
    gender: 0,
    avatarUrl: 'https://s16-imfile-sg.feishucdn.com/static-resource/v1/v3_00m3_91ab4b99-f4f1-483d-8f2f-4114d3e801hu~?image_size=240x240&cut_type=&quality=&format=png&sticker_format=.webp',
    employeeNo: '',
    employeeType: 1,
    jobTitle: '',
    joinTime: 1714003200,
    isActivated: true,
    isResigned: false,
    isFrozen: false,
    departmentIds: ['od-99928b44cfb00523000e1bd401b3717f', 'od-111b2cf1febbdb39c3882ea3ea6300b1'],
    leaderUserId: 'ou_fd1acd947ba0173370c5426e1b35af06',
    enterpriseEmail: '',
  },
  {
    openId: 'ou_1113af92eebfce44dc99092692cb11e8',
    userId: 'ASV008',
    name: 'Huan',
    enName: '',
    email: '',
    mobile: '+84876787879',
    gender: 0,
    avatarUrl: 'https://s16-imfile-sg.feishucdn.com/static-resource/v1/v3_00m4_4186313a-58da-4cb5-a388-f3aabffc63hu~?image_size=240x240&cut_type=&quality=&format=png&sticker_format=.webp',
    employeeNo: '',
    employeeType: 1,
    jobTitle: '',
    joinTime: 1677628800,
    isActivated: true,
    isResigned: false,
    isFrozen: false,
    departmentIds: ['od-99928b44cfb00523000e1bd401b3717f', 'od-111b2cf1febbdb39c3882ea3ea6300b1'],
    leaderUserId: 'ou_fd1acd947ba0173370c5426e1b35af06',
    enterpriseEmail: '',
  },
  {
    openId: 'ou_323eeea46bec22ff6ff644ae324d2250',
    userId: 'ASV0016',
    name: 'Lê Ngọc Khánh',
    enName: '',
    email: '',
    mobile: '+84876190791',
    gender: 0,
    avatarUrl: 'https://s16-imfile-sg.feishucdn.com/static-resource/v1/v3_00m3_43914972-fc37-4165-9ae5-7b5d831379hu~?image_size=240x240&cut_type=&quality=&format=png&sticker_format=.webp',
    employeeNo: '',
    employeeType: 1,
    jobTitle: '',
    joinTime: 1702684800,
    isActivated: true,
    isResigned: false,
    isFrozen: false,
    departmentIds: ['od-99928b44cfb00523000e1bd401b3717f', 'od-111b2cf1febbdb39c3882ea3ea6300b1'],
    leaderUserId: 'ou_fd1acd947ba0173370c5426e1b35af06',
    enterpriseEmail: '',
  },
  {
    openId: 'ou_a9b9af1c2366706094ebaf390d49f3d2',
    userId: 'ASV0018',
    name: 'Phan Anh Hùng',
    enName: '',
    email: '',
    mobile: '+84963755453',
    gender: 1,
    avatarUrl: 'https://s16-imfile-sg.feishucdn.com/static-resource/v1/v3_00m4_d790a931-a700-42de-9cf7-d8bb30ed46hu~?image_size=240x240&cut_type=&quality=&format=png&sticker_format=.webp',
    employeeNo: '',
    employeeType: 1,
    jobTitle: '',
    joinTime: 1728950400,
    isActivated: true,
    isResigned: false,
    isFrozen: false,
    departmentIds: ['od-99928b44cfb00523000e1bd401b3717f', 'od-111b2cf1febbdb39c3882ea3ea6300b1'],
    leaderUserId: 'ou_fd1acd947ba0173370c5426e1b35af06',
    enterpriseEmail: '',
  },
  {
    openId: 'ou_228a42053f1860c8ca5980bf5c2c22d6',
    userId: 'ASV023',
    name: 'Vũ Thị Thanh Ngọc',
    enName: '',
    email: 'ngoc-t@asnovavn.com',
    enterpriseEmail: 'ngoc-t@asnovavn.com',
    mobile: '+84946081192',
    gender: 2,
    avatarUrl: 'https://s16-imfile-sg.feishucdn.com/static-resource/v1/v3_00q1_738df1f9-e702-481a-950f-9b1b661ec3hu~?image_size=240x240&cut_type=&quality=&format=png&sticker_format=.webp',
    employeeNo: 'ASV023',
    employeeType: 1,
    jobTitle: '',
    joinTime: 1757894400,
    isActivated: true,
    isResigned: false,
    isFrozen: false,
    departmentIds: ['od-99928b44cfb00523000e1bd401b3717f'],
    leaderUserId: 'ou_fd1acd947ba0173370c5426e1b35af06',
  },
  {
    openId: 'ou_b211ed29459cc29914d75e91d86447d7',
    userId: 'ddddeb3c',
    name: 'UpB Support',
    enName: '',
    email: 'dx@upbase.asia',
    enterpriseEmail: 'asnovasupport@asnovavn.com',
    mobile: '',
    gender: 0,
    avatarUrl: 'https://s16-imfile-sg.feishucdn.com/static-resource/v1/v3_00nc_32d8062a-32bf-4684-be9b-7f839c3c51hu~?image_size=240x240&cut_type=&quality=&format=png&sticker_format=.webp',
    employeeNo: '',
    employeeType: 1,
    jobTitle: '',
    joinTime: 1652054400,
    isActivated: true,
    isResigned: false,
    isFrozen: false,
    departmentIds: ['od-0beae804da4601162fd550fc7a4caedd'],
  },
];

// ─── Helpers ────────────────────────────────────────────────

/** Get primary department name for an employee */
export function getDeptName(emp: LarkEmployee): string {
  const primaryDepartmentId = emp.departmentIds[0];
  return primaryDepartmentId ? DEPT_MAP[primaryDepartmentId] || 'N/A' : 'N/A';
}

/** Format unix timestamp to DD/MM/YYYY */
export function formatJoinDate(ts: number): string {
  if (!ts) return 'N/A';
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Employee status label */
export function getStatusLabel(emp: LarkEmployee): string {
  if (emp.isResigned) return 'Nghỉ việc';
  if (emp.isFrozen) return 'Tạm khóa';
  if (emp.isActivated) return 'Đang làm';
  return 'Chờ kích hoạt';
}

/** Employee status key for StatusBadge */
export function getStatusKey(emp: LarkEmployee): string {
  if (emp.isResigned) return 'failed';
  if (emp.isFrozen) return 'warning';
  if (emp.isActivated) return 'active';
  return 'pending';
}
