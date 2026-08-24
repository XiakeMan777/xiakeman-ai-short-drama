export const CHARACTER_COLORS = ["#ef4444", "#22c55e", "#3b82f6", "#f59e0b", "#a855f7", "#ec4899", "#06b6d4", "#f97316"];

export const POSES = [
  "站立", "行走", "奔跑", "坐姿", "躺姿", "挥手",
  "蹲下", "单膝跪", "双膝跪", "倚靠", "鞠躬", "思考",
  "踢球", "投掷", "推进", "伸手", "抱臂", "看手机",
] as const;

export const GENDERS = [
  { value: "male" as const, label: "男", height: 1.8 },
  { value: "female" as const, label: "女", height: 1.65 },
  { value: "child" as const, label: "小孩", height: 1.2 },
];

export const CAMERA_PRESETS = [
  { label: "正面", px: 0, py: 1.6, pz: 5, tx: 0, ty: 1, tz: 0, fov: 50 },
  { label: "侧面", px: 5, py: 1.6, pz: 0, tx: 0, ty: 1, tz: 0, fov: 50 },
  { label: "45度", px: 3.5, py: 1.6, pz: 3.5, tx: 0, ty: 1, tz: 0, fov: 50 },
  { label: "俯视", px: 0, py: 8, pz: 2, tx: 0, ty: 0, tz: 0, fov: 50 },
  { label: "低角度", px: 2, py: 0.3, pz: 3, tx: 0, ty: 1, tz: 0, fov: 35 },
  { label: "过肩", px: 1.2, py: 1.7, pz: 1.5, tx: 2, ty: 1.4, tz: 0, fov: 40 },
  { label: "荷兰角", px: 3, py: 2, pz: 3, tx: 0, ty: 1, tz: 0, fov: 35 },
  { label: "远景", px: 0, py: 3, pz: 12, tx: 0, ty: 1, tz: 0, fov: 35 },
  { label: "特写", px: 0.5, py: 1.6, pz: 1.2, tx: 0, ty: 1.5, tz: 0, fov: 70 },
  { label: "斜俯", px: 4, py: 5, pz: 4, tx: 0, ty: 1, tz: 0, fov: 45 },
];

export const PROP_COLORS = ["#6b7280", "#92400e", "#065f46", "#1e3a5f", "#7c2d12", "#374151", "#d4d4d8"];

export const SCENE_TEMPLATES = [
  { label: "双人对话", chars: [
    { x: -1.5, z: 0, rotationY: 30, pose: "站立" },
    { x: 1.5, z: 0, rotationY: -30, pose: "站立" },
  ]},
  { label: "三人场景", chars: [
    { x: 0, z: -1, rotationY: 0, pose: "站立" },
    { x: -2, z: 1, rotationY: 30, pose: "行走" },
    { x: 2, z: 1, rotationY: -30, pose: "挥手" },
  ]},
  { label: "追逐", chars: [
    { x: -3, z: 0, rotationY: -10, pose: "奔跑" },
    { x: 0, z: 0, rotationY: -10, pose: "奔跑" },
    { x: 3, z: 0.5, rotationY: -15, pose: "奔跑" },
  ]},
  { label: "围坐", chars: [
    { x: 0, z: -1, rotationY: 0, pose: "坐姿" },
    { x: -1.5, z: 0.5, rotationY: 60, pose: "坐姿" },
    { x: 1.5, z: 0.5, rotationY: -60, pose: "坐姿" },
    { x: 0, z: 2, rotationY: 180, pose: "坐姿" },
  ]},
];



