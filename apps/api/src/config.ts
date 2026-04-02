import "dotenv/config";

const required = ["DATABASE_URL", "JWT_SECRET"] as const;
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing environment variable: ${key}`);
  }
}

export const config = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET as string,
  officePublicIp: process.env.OFFICE_PUBLIC_IP || "",
  officeLatitude: Number(process.env.OFFICE_LATITUDE || 0),
  officeLongitude: Number(process.env.OFFICE_LONGITUDE || 0),
  officeRadiusMeters: Number(process.env.OFFICE_RADIUS_METERS || 75),
  homeRadiusMeters: Number(process.env.HOME_RADIUS_METERS || 100),
  wfhCodeTtlHours: Number(process.env.WFH_CODE_TTL_HOURS || 24)
};
