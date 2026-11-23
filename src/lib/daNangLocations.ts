export interface DaNangBuilding {
  name: string;
  address: string;
  fullLabel: string;
  lat: number;
  lng: number;
}

export const DANANG_BUILDINGS: DaNangBuilding[] = [
  {
    name: "Software Park Đà Nẵng",
    address: "02 Quang Trung, Hải Châu",
    fullLabel: "Software Park Đà Nẵng (02 Quang Trung, Hải Châu)",
    lat: 16.0777,
    lng: 108.2225,
  },
  {
    name: "Công viên Phần mềm số 2",
    address: "Thuận Phước, Hải Châu",
    fullLabel: "Công viên Phần mềm số 2 (Software Park 2 - Thuận Phước)",
    lat: 16.0906,
    lng: 108.2229,
  },
  {
    name: "Indochina Riverside Towers",
    address: "74 Bạch Đằng, Hải Châu",
    fullLabel: "Indochina Riverside Towers (74 Bạch Đằng, Hải Châu)",
    lat: 16.0706,
    lng: 108.2249,
  },
  {
    name: "ACB Tower Đà Nẵng",
    address: "218 Bạch Đằng, Hải Châu",
    fullLabel: "ACB Tower Đà Nẵng (218 Bạch Đằng, Hải Châu)",
    lat: 16.0631,
    lng: 108.2241,
  },
  {
    name: "Tòa nhà Bưu điện Đà Nẵng",
    address: "155 Trần Phú, Hải Châu",
    fullLabel: "Tòa nhà Bưu điện Đà Nẵng (155 Trần Phú, Hải Châu)",
    lat: 16.0674,
    lng: 108.2236,
  },
  {
    name: "Trung tâm Hành chính Đà Nẵng",
    address: "24 Trần Phú, Hải Châu",
    fullLabel: "Trung tâm Hành chính Đà Nẵng (24 Trần Phú, Hải Châu)",
    lat: 16.0771,
    lng: 108.2242,
  },
  {
    name: "Tòa nhà Viettel Đà Nẵng",
    address: "Nguyễn Văn Linh, Hải Châu",
    fullLabel: "Tòa nhà Viettel Đà Nẵng (Nguyễn Văn Linh, Hải Châu)",
    lat: 16.0604,
    lng: 108.2179,
  },
  {
    name: "Tòa nhà Phi Long Technology",
    address: "52 Nguyễn Văn Linh, Thanh Khê",
    fullLabel: "Tòa nhà Phi Long Technology (Nguyễn Văn Linh, Thanh Khê)",
    lat: 16.0605,
    lng: 108.2156,
  },
  {
    name: "Vĩnh Trung Plaza",
    address: "255 Hùng Vương, Thanh Khê",
    fullLabel: "Vĩnh Trung Plaza (255 Hùng Vương, Thanh Khê)",
    lat: 16.0666,
    lng: 108.2128,
  },
  {
    name: "Vincom Plaza Ngô Quyền",
    address: "910A Ngô Quyền, Sơn Trà",
    fullLabel: "Vincom Plaza Ngô Quyền (910A Ngô Quyền, Sơn Trà)",
    lat: 16.0721,
    lng: 108.2302,
  },
  {
    name: "Lotte Mart Đà Nẵng",
    address: "06 Nại Nam, Hải Châu",
    fullLabel: "Lotte Mart Đà Nẵng (06 Nại Nam, Hải Châu)",
    lat: 16.0344,
    lng: 108.2292,
  },
  {
    name: "FPT Complex Đà Nẵng",
    address: "KĐT FPT City, Ngũ Hành Sơn",
    fullLabel: "FPT Complex Đà Nẵng (KĐT FPT City, Ngũ Hành Sơn)",
    lat: 15.9788,
    lng: 108.2615,
  },
];

export function calculateDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function formatDistanceLabel(km: number): string {
  if (km < 1) {
    return `${Math.max(50, Math.round((km * 1000) / 10) * 10)} m`;
  }
  return `${km.toFixed(1)} km`;
}

export function normalizeVietnamese(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .trim();
}
