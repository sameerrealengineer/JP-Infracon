import {
  check,
  date,
  decimal,
  foreignKey,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

/** Authentication identity and organisation-scoped business memberships are separate records. */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin", "super_admin"]).default("user").notNull(),
  accountStatus: mysqlEnum("accountStatus", ["Active", "Suspended", "Deactivated"])
    .default("Active")
    .notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const userCredentials = mysqlTable(
  "user_credentials",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    username: varchar("username", { length: 32 }).notNull(),
    passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
    mustChangePassword: int("mustChangePassword").default(0).notNull(),
    passwordChangedAt: timestamp("passwordChangedAt").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    usernameUnique: uniqueIndex("user_credentials_username_uq").on(table.username),
    userUnique: uniqueIndex("user_credentials_user_uq").on(table.userId),
  }),
);

export const authSessions = mysqlTable(
  "auth_sessions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    revokedAt: timestamp("revokedAt"),
  },
  (table) => ({
    userExpiryIndex: index("auth_sessions_user_expiry_idx").on(table.userId, table.expiresAt),
  }),
);

export const loginAttempts = mysqlTable("login_attempts", {
  identifierHash: varchar("identifierHash", { length: 64 }).primaryKey(),
  failedAttempts: int("failedAttempts").default(0).notNull(),
  windowStartedAt: timestamp("windowStartedAt").defaultNow().notNull(),
  lockedUntil: timestamp("lockedUntil"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const systemBootstrap = mysqlTable("system_bootstrap", {
  bootstrapKey: varchar("bootstrapKey", { length: 64 }).primaryKey(),
  completedAt: timestamp("completedAt"),
  completedByUserId: int("completedByUserId").references(() => users.id, { onDelete: "restrict" }),
});

export const organizations = mysqlTable("organizations", {
  id: varchar("id", { length: 36 }).primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  code: varchar("code", { length: 32 }).notNull().unique(),
  status: mysqlEnum("status", ["Active", "Inactive"]).default("Active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const organizationMemberships = mysqlTable(
  "organization_memberships",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 })
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    businessRole: mysqlEnum("businessRole", [
      "owner",
      "director",
      "admin",
      "project_manager",
      "supervisor",
      "accounts",
      "storekeeper",
      "auditor",
    ]).notNull(),
    status: mysqlEnum("status", ["Invited", "Active", "Suspended", "Deactivated"])
      .default("Active")
      .notNull(),
    joinedAt: timestamp("joinedAt").defaultNow().notNull(),
    createdBy: int("createdBy")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    memberRoleUnique: uniqueIndex("org_member_role_uq").on(
      table.organizationId,
      table.userId,
      table.businessRole,
    ),
    userStatusIndex: index("org_member_user_status_idx").on(table.userId, table.status),
  }),
);

export const projects = mysqlTable(
  "projects",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 })
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    projectCode: varchar("projectCode", { length: 32 }).notNull(),
    name: varchar("name", { length: 180 }).notNull(),
    clientDepartment: varchar("clientDepartment", { length: 180 }),
    projectType: varchar("projectType", { length: 64 }),
    startDate: date("startDate", { mode: "string" }),
    targetEndDate: date("targetEndDate", { mode: "string" }),
    status: mysqlEnum("status", ["Active", "On Hold", "Completed", "Inactive"])
      .default("Active")
      .notNull(),
    projectManagerUserId: int("projectManagerUserId").references(() => users.id, {
      onDelete: "restrict",
    }),
    createdBy: int("createdBy")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    projectCodeUnique: uniqueIndex("project_org_code_uq").on(
      table.organizationId,
      table.projectCode,
    ),
    projectOrgIdUnique: uniqueIndex("project_org_id_uq").on(table.organizationId, table.id),
    orgStatusIndex: index("project_org_status_idx").on(table.organizationId, table.status),
  }),
);

export const sites = mysqlTable(
  "sites",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 })
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    projectId: varchar("projectId", { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    siteCode: varchar("siteCode", { length: 32 }).notNull(),
    name: varchar("name", { length: 180 }).notNull(),
    address: text("address"),
    village: varchar("village", { length: 120 }),
    district: varchar("district", { length: 120 }),
    state: varchar("state", { length: 120 }),
    timeZone: varchar("timeZone", { length: 64 }).default("Asia/Kolkata").notNull(),
    status: mysqlEnum("status", ["Active", "On Hold", "Completed", "Inactive"])
      .default("Active")
      .notNull(),
    createdBy: int("createdBy")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    siteCodeUnique: uniqueIndex("site_org_code_uq").on(table.organizationId, table.siteCode),
    siteOrgIdUnique: uniqueIndex("site_org_id_uq").on(table.organizationId, table.id),
    projectSameOrganization: foreignKey({
      name: "site_project_same_org_fk",
      columns: [table.organizationId, table.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }).onDelete("restrict"),
    projectStatusIndex: index("site_project_status_idx").on(table.projectId, table.status),
  }),
);

export const siteAssignments = mysqlTable(
  "site_assignments",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    siteId: varchar("siteId", { length: 36 })
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    assignmentRole: varchar("assignmentRole", { length: 64 }).notNull(),
    effectiveFrom: timestamp("effectiveFrom").defaultNow().notNull(),
    effectiveTo: timestamp("effectiveTo"),
    status: mysqlEnum("status", ["Active", "Revoked"]).default("Active").notNull(),
    assignedBy: int("assignedBy")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    assignmentIndex: index("site_assignment_user_status_idx").on(
      table.userId,
      table.status,
      table.siteId,
    ),
  }),
);

export const workTasks = mysqlTable(
  "work_tasks",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 })
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: varchar("siteId", { length: 36 })
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    taskCode: varchar("taskCode", { length: 32 }).notNull(),
    title: varchar("title", { length: 180 }).notNull(),
    description: text("description"),
    workCategory: varchar("workCategory", { length: 80 }),
    locationLabel: varchar("locationLabel", { length: 180 }),
    plannedStart: date("plannedStart", { mode: "string" }).notNull(),
    plannedEnd: date("plannedEnd", { mode: "string" }).notNull(),
    priority: mysqlEnum("priority", ["Low", "Normal", "High", "Critical"])
      .default("Normal")
      .notNull(),
    status: mysqlEnum("status", [
      "Planned",
      "Ready",
      "In Progress",
      "On Hold",
      "Completed",
      "Cancelled",
      "Blocked",
      "Awaiting Inspection",
    ])
      .default("Planned")
      .notNull(),
    holdReason: text("holdReason"),
    scheduleRevision: int("scheduleRevision").default(1).notNull(),
    recordVersion: int("recordVersion").default(1).notNull(),
    clientMutationId: varchar("clientMutationId", { length: 64 }).notNull().unique(),
    createdBy: int("createdBy")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    taskCodeUnique: uniqueIndex("work_task_site_code_uq").on(table.siteId, table.taskCode),
    taskSiteIdUnique: uniqueIndex("work_task_site_id_uq").on(table.siteId, table.id),
    taskSameOrganizationSite: foreignKey({
      name: "work_task_same_org_site_fk",
      columns: [table.organizationId, table.siteId],
      foreignColumns: [sites.organizationId, sites.id],
    }).onDelete("restrict"),
    taskSiteDatesIndex: index("work_task_site_dates_idx").on(
      table.siteId,
      table.plannedStart,
      table.plannedEnd,
    ),
    taskSiteStatusIndex: index("work_task_site_status_idx").on(table.siteId, table.status),
  }),
);

export const taskDependencies = mysqlTable(
  "task_dependencies",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    siteId: varchar("siteId", { length: 36 })
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    predecessorTaskId: varchar("predecessorTaskId", { length: 36 })
      .notNull()
      .references(() => workTasks.id, { onDelete: "restrict" }),
    successorTaskId: varchar("successorTaskId", { length: 36 })
      .notNull()
      .references(() => workTasks.id, { onDelete: "restrict" }),
    dependencyType: mysqlEnum("dependencyType", ["Finish-to-Start"])
      .default("Finish-to-Start")
      .notNull(),
    lagDays: int("lagDays").default(0).notNull(),
    createdBy: int("createdBy")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    notSelfDependent: check(
      "task_dependency_not_self_chk",
      sql`${table.predecessorTaskId} <> ${table.successorTaskId}`,
    ),
    nonNegativeLag: check("task_dependency_lag_nonnegative_chk", sql`${table.lagDays} >= 0`),
    predecessorMustBeInSite: foreignKey({
      name: "task_dependency_predecessor_same_site_fk",
      columns: [table.siteId, table.predecessorTaskId],
      foreignColumns: [workTasks.siteId, workTasks.id],
    }).onDelete("restrict"),
    successorMustBeInSite: foreignKey({
      name: "task_dependency_successor_same_site_fk",
      columns: [table.siteId, table.successorTaskId],
      foreignColumns: [workTasks.siteId, workTasks.id],
    }).onDelete("restrict"),
    dependencyUnique: uniqueIndex("task_dependency_edge_uq").on(
      table.predecessorTaskId,
      table.successorTaskId,
    ),
    dependencySiteIndex: index("task_dependency_site_successor_idx").on(
      table.siteId,
      table.successorTaskId,
    ),
  }),
);

export const taskScheduleChanges = mysqlTable(
  "task_schedule_changes",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 })
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: varchar("siteId", { length: 36 })
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    selectedTaskId: varchar("selectedTaskId", { length: 36 })
      .notNull()
      .references(() => workTasks.id, { onDelete: "restrict" }),
    changeType: mysqlEnum("changeType", ["Initial Plan", "Reschedule"]).notNull(),
    strategy: mysqlEnum("strategy", ["selected_only", "shift_dependents"]).notNull(),
    reasonCode: varchar("reasonCode", { length: 64 }).notNull(),
    reasonText: text("reasonText"),
    impactSummary: text("impactSummary").notNull(),
    status: mysqlEnum("status", ["Applied"]).default("Applied").notNull(),
    requestedBy: int("requestedBy")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    clientMutationId: varchar("clientMutationId", { length: 64 }).notNull().unique(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    changeMustMatchSiteOrganization: foreignKey({
      name: "task_schedule_change_same_org_site_fk",
      columns: [table.organizationId, table.siteId],
      foreignColumns: [sites.organizationId, sites.id],
    }).onDelete("restrict"),
    selectedTaskMustMatchSite: foreignKey({
      name: "task_schedule_change_selected_same_site_fk",
      columns: [table.siteId, table.selectedTaskId],
      foreignColumns: [workTasks.siteId, workTasks.id],
    }).onDelete("restrict"),
    changeSiteIdUnique: uniqueIndex("task_schedule_change_site_id_uq").on(table.siteId, table.id),
    changeSiteTimeIndex: index("task_schedule_change_site_time_idx").on(
      table.siteId,
      table.createdAt,
    ),
    changeSelectedTaskIndex: index("task_schedule_change_task_idx").on(
      table.selectedTaskId,
      table.createdAt,
    ),
  }),
);

export const taskScheduleRevisions = mysqlTable(
  "task_schedule_revisions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    changeId: varchar("changeId", { length: 36 })
      .notNull()
      .references(() => taskScheduleChanges.id, { onDelete: "restrict" }),
    siteId: varchar("siteId", { length: 36 }).notNull(),
    taskId: varchar("taskId", { length: 36 })
      .notNull()
      .references(() => workTasks.id, { onDelete: "restrict" }),
    revisionNumber: int("revisionNumber").notNull(),
    oldStart: date("oldStart", { mode: "string" }),
    oldEnd: date("oldEnd", { mode: "string" }),
    newStart: date("newStart", { mode: "string" }).notNull(),
    newEnd: date("newEnd", { mode: "string" }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    revisionChangeMustMatchSite: foreignKey({
      name: "task_schedule_revision_change_same_site_fk",
      columns: [table.siteId, table.changeId],
      foreignColumns: [taskScheduleChanges.siteId, taskScheduleChanges.id],
    }).onDelete("restrict"),
    revisionTaskMustMatchSite: foreignKey({
      name: "task_schedule_revision_task_same_site_fk",
      columns: [table.siteId, table.taskId],
      foreignColumns: [workTasks.siteId, workTasks.id],
    }).onDelete("restrict"),
    revisionUnique: uniqueIndex("task_schedule_revision_task_number_uq").on(
      table.taskId,
      table.revisionNumber,
    ),
    revisionChangeIndex: index("task_schedule_revision_change_idx").on(table.changeId),
  }),
);

export const permissionGrants = mysqlTable(
  "permission_grants",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 })
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    scopeType: mysqlEnum("scopeType", ["organization", "project", "site"]).notNull(),
    scopeId: varchar("scopeId", { length: 36 }).notNull(),
    permissionKey: varchar("permissionKey", { length: 96 }).notNull(),
    effect: mysqlEnum("effect", ["allow", "deny"]).notNull(),
    maxAmountMinor: int("maxAmountMinor"),
    dailyLimitMinor: int("dailyLimitMinor"),
    monthlyLimitMinor: int("monthlyLimitMinor"),
    requiresEvidence: mysqlEnum("requiresEvidence", ["yes", "no"]).default("no").notNull(),
    effectiveFrom: timestamp("effectiveFrom").defaultNow().notNull(),
    effectiveTo: timestamp("effectiveTo"),
    status: mysqlEnum("status", ["Active", "Revoked"]).default("Active").notNull(),
    grantedBy: int("grantedBy")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    revokedBy: int("revokedBy").references(() => users.id, { onDelete: "restrict" }),
    revokedAt: timestamp("revokedAt"),
    reason: text("reason"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    grantLookupIndex: index("permission_grant_lookup_idx").on(
      table.userId,
      table.permissionKey,
      table.status,
    ),
  }),
);

export const people = mysqlTable(
  "people",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 })
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    personType: mysqlEnum("personType", ["worker", "technician", "subcontractor_contact"])
      .default("worker")
      .notNull(),
    fullName: varchar("fullName", { length: 180 }).notNull(),
    phone: varchar("phone", { length: 40 }),
    skillCategory: mysqlEnum("skillCategory", [
      "Skilled",
      "Semi-skilled",
      "Unskilled",
      "Not specified",
    ])
      .default("Not specified")
      .notNull(),
    tradeType: varchar("tradeType", { length: 80 }),
    status: mysqlEnum("status", ["Draft", "Active", "Inactive"]).default("Draft").notNull(),
    kycStatus: mysqlEnum("kycStatus", [
      "Not Required",
      "Pending",
      "Verified by authorised reviewer",
      "Rejected",
    ])
      .default("Not Required")
      .notNull(),
    kycReviewedBy: int("kycReviewedBy").references(() => users.id, { onDelete: "restrict" }),
    kycReviewedAt: timestamp("kycReviewedAt"),
    kycReviewReason: text("kycReviewReason"),
    clientMutationId: varchar("clientMutationId", { length: 64 }).notNull().unique(),
    createdBy: int("createdBy")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    peopleOrgIdUnique: uniqueIndex("people_org_id_uq").on(table.organizationId, table.id),
    peopleOrgStatusIndex: index("people_org_status_idx").on(table.organizationId, table.status),
  }),
);

export const personSiteAssignments = mysqlTable(
  "person_site_assignments",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 })
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    personId: varchar("personId", { length: 36 })
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    siteId: varchar("siteId", { length: 36 })
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    status: mysqlEnum("status", ["Active", "Revoked"]).default("Active").notNull(),
    assignedBy: int("assignedBy")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    personSiteUnique: uniqueIndex("person_site_assignment_uq").on(table.personId, table.siteId),
    personMustMatchOrganization: foreignKey({
      name: "person_site_person_same_org_fk",
      columns: [table.organizationId, table.personId],
      foreignColumns: [people.organizationId, people.id],
    }).onDelete("restrict"),
    siteMustMatchOrganization: foreignKey({
      name: "person_site_site_same_org_fk",
      columns: [table.organizationId, table.siteId],
      foreignColumns: [sites.organizationId, sites.id],
    }).onDelete("restrict"),
    personSiteStatusIndex: index("person_site_status_idx").on(
      table.siteId,
      table.status,
      table.personId,
    ),
  }),
);

export const workerEngagements = mysqlTable(
  "worker_engagements",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 })
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    personId: varchar("personId", { length: 36 })
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    siteId: varchar("siteId", { length: 36 })
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    engagementType: varchar("engagementType", { length: 64 }).notNull(),
    rateType: mysqlEnum("rateType", [
      "daily",
      "hourly",
      "shift",
      "piece",
      "per_connection",
      "per_measurement",
      "contract",
    ]).notNull(),
    rateMinor: int("rateMinor").notNull(),
    currency: varchar("currency", { length: 3 }).default("INR").notNull(),
    effectiveFrom: date("effectiveFrom", { mode: "string" }).notNull(),
    effectiveTo: date("effectiveTo", { mode: "string" }),
    status: mysqlEnum("status", ["Draft", "Active", "Ended", "Rejected"])
      .default("Draft")
      .notNull(),
    approvedBy: int("approvedBy").references(() => users.id, { onDelete: "restrict" }),
    reviewedAt: timestamp("reviewedAt"),
    reviewReason: text("reviewReason"),
    createdBy: int("createdBy").references(() => users.id, { onDelete: "restrict" }),
    clientMutationId: varchar("clientMutationId", { length: 64 }).notNull().unique(),
    contractReference: varchar("contractReference", { length: 120 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    rateMustBePositive: check("worker_engagement_rate_positive_chk", sql`${table.rateMinor} > 0`),
    validEffectiveRange: check(
      "worker_engagement_effective_range_chk",
      sql`${table.effectiveTo} is null or ${table.effectiveTo} >= ${table.effectiveFrom}`,
    ),
    personMustMatchOrganization: foreignKey({
      name: "worker_engagement_person_same_org_fk",
      columns: [table.organizationId, table.personId],
      foreignColumns: [people.organizationId, people.id],
    }).onDelete("restrict"),
    siteMustMatchOrganization: foreignKey({
      name: "worker_engagement_site_same_org_fk",
      columns: [table.organizationId, table.siteId],
      foreignColumns: [sites.organizationId, sites.id],
    }).onDelete("restrict"),
    engagementSiteIdUnique: uniqueIndex("worker_engagement_site_id_uq").on(table.siteId, table.id),
    engagementSiteStatusIndex: index("engagement_site_status_idx").on(table.siteId, table.status),
    engagementPersonRateIndex: index("engagement_person_rate_idx").on(
      table.siteId,
      table.personId,
      table.engagementType,
      table.effectiveFrom,
    ),
  }),
);

export const dailyReports = mysqlTable(
  "daily_reports",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 })
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: varchar("siteId", { length: 36 })
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    reportKind: mysqlEnum("reportKind", ["DPR", "DLR"]).notNull(),
    reportDate: date("reportDate", { mode: "string" }).notNull(),
    shiftCode: varchar("shiftCode", { length: 32 }).default("General").notNull(),
    title: varchar("title", { length: 180 }).notNull(),
    weatherCode: varchar("weatherCode", { length: 64 }),
    overallStatus: varchar("overallStatus", { length: 64 }),
    remarks: text("remarks"),
    nextDayPlan: text("nextDayPlan"),
    status: mysqlEnum("status", [
      "Draft",
      "Submitted",
      "Under Review",
      "Approved",
      "Returned for Correction",
    ])
      .default("Draft")
      .notNull(),
    revisionNumber: int("revisionNumber").default(1).notNull(),
    clientMutationId: varchar("clientMutationId", { length: 64 }).notNull().unique(),
    createdBy: int("createdBy")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    submittedAt: timestamp("submittedAt"),
    reviewedBy: int("reviewedBy").references(() => users.id, { onDelete: "restrict" }),
    reviewedAt: timestamp("reviewedAt"),
    returnReason: text("returnReason"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    reportSiteDateIndex: index("daily_report_site_date_idx").on(table.siteId, table.reportDate),
    reportStatusIndex: index("daily_report_status_idx").on(table.organizationId, table.status),
    reportRevisionUnique: uniqueIndex("daily_report_site_date_shift_revision_uq").on(
      table.siteId,
      table.reportDate,
      table.shiftCode,
      table.revisionNumber,
    ),
  }),
);

export const dailyReportItems = mysqlTable(
  "daily_report_items",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    dailyReportId: varchar("dailyReportId", { length: 36 })
      .notNull()
      .references(() => dailyReports.id, { onDelete: "restrict" }),
    taskId: varchar("taskId", { length: 36 }),
    workItemCode: varchar("workItemCode", { length: 80 }),
    description: varchar("description", { length: 240 }).notNull(),
    locationLabel: varchar("locationLabel", { length: 180 }),
    plannedQuantity: decimal("plannedQuantity", { precision: 14, scale: 3 }),
    completedQuantityToday: decimal("completedQuantityToday", { precision: 14, scale: 3 }),
    cumulativeQuantity: decimal("cumulativeQuantity", { precision: 14, scale: 3 }),
    unitCode: varchar("unitCode", { length: 32 }),
    estimatedPercent: decimal("estimatedPercent", { precision: 5, scale: 2 }),
    remarks: text("remarks"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    reportItemIndex: index("daily_report_item_parent_idx").on(table.dailyReportId),
  }),
);

export const attendanceRecords = mysqlTable(
  "attendance_records",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 })
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: varchar("siteId", { length: 36 })
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    reportId: varchar("reportId", { length: 36 }).references(() => dailyReports.id, {
      onDelete: "restrict",
    }),
    workDate: date("workDate", { mode: "string" }).notNull(),
    shiftCode: varchar("shiftCode", { length: 32 }).notNull(),
    workerEngagementId: varchar("workerEngagementId", { length: 36 })
      .notNull()
      .references(() => workerEngagements.id, { onDelete: "restrict" }),
    attendanceStatus: mysqlEnum("attendanceStatus", [
      "Full Day",
      "Half Day",
      "Absent",
      "Leave",
      "Present-hours-based",
    ]).notNull(),
    regularHours: decimal("regularHours", { precision: 6, scale: 2 }).default("0").notNull(),
    overtimeHours: decimal("overtimeHours", { precision: 6, scale: 2 }).default("0").notNull(),
    overtimeApprovalStatus: mysqlEnum("overtimeApprovalStatus", [
      "Not Applicable",
      "Pending",
      "Approved",
      "Rejected",
    ])
      .default("Not Applicable")
      .notNull(),
    rateSnapshotMinor: int("rateSnapshotMinor"),
    currency: varchar("currency", { length: 3 }).default("INR").notNull(),
    markedBy: int("markedBy")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reviewedBy: int("reviewedBy").references(() => users.id, { onDelete: "restrict" }),
    correctionOfId: varchar("correctionOfId", { length: 36 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    attendanceUnique: uniqueIndex("attendance_engagement_site_date_shift_uq").on(
      table.workerEngagementId,
      table.siteId,
      table.workDate,
      table.shiftCode,
    ),
    engagementMustMatchSite: foreignKey({
      name: "attendance_engagement_same_site_fk",
      columns: [table.siteId, table.workerEngagementId],
      foreignColumns: [workerEngagements.siteId, workerEngagements.id],
    }).onDelete("restrict"),
    attendanceSiteDateIndex: index("attendance_site_date_idx").on(table.siteId, table.workDate),
  }),
);

export const materialItems = mysqlTable(
  "material_items",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 })
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    itemCode: varchar("itemCode", { length: 48 }).notNull(),
    name: varchar("name", { length: 180 }).notNull(),
    category: varchar("category", { length: 80 }),
    specification: varchar("specification", { length: 180 }),
    baseUnitCode: varchar("baseUnitCode", { length: 32 }).notNull(),
    reorderThreshold: decimal("reorderThreshold", { precision: 14, scale: 3 }),
    clientMutationId: varchar("clientMutationId", { length: 64 }).unique(),
    status: mysqlEnum("status", ["Active", "Inactive"]).default("Active").notNull(),
    createdBy: int("createdBy")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    itemCodeUnique: uniqueIndex("material_item_org_code_uq").on(
      table.organizationId,
      table.itemCode,
    ),
    itemOrganizationIdUnique: uniqueIndex("material_item_org_id_uq").on(
      table.organizationId,
      table.id,
    ),
  }),
);

export const materialRequests = mysqlTable(
  "material_requests",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 })
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: varchar("siteId", { length: 36 })
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    requestedBy: int("requestedBy")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    requiredBy: date("requiredBy", { mode: "string" }),
    purpose: text("purpose"),
    status: mysqlEnum("status", [
      "Submitted",
      "Approved",
      "Partially Approved",
      "Returned",
      "Rejected",
      "Cancelled",
    ])
      .default("Submitted")
      .notNull(),
    approvalNote: text("approvalNote"),
    reviewedBy: int("reviewedBy").references(() => users.id, { onDelete: "restrict" }),
    reviewedAt: timestamp("reviewedAt"),
    clientMutationId: varchar("clientMutationId", { length: 64 }).notNull().unique(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    requestSiteDateIndex: index("material_request_site_date_idx").on(table.siteId, table.createdAt),
    requestStatusIndex: index("material_request_status_idx").on(table.organizationId, table.status),
  }),
);

export const materialRequestItems = mysqlTable(
  "material_request_items",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    requestId: varchar("requestId", { length: 36 })
      .notNull()
      .references(() => materialRequests.id, { onDelete: "restrict" }),
    materialItemId: varchar("materialItemId", { length: 36 }).references(() => materialItems.id, {
      onDelete: "restrict",
    }),
    itemNameSnapshot: varchar("itemNameSnapshot", { length: 180 }).notNull(),
    requestedQuantity: decimal("requestedQuantity", { precision: 14, scale: 3 }).notNull(),
    approvedQuantity: decimal("approvedQuantity", { precision: 14, scale: 3 }),
    unitCode: varchar("unitCode", { length: 32 }).notNull(),
    remarks: text("remarks"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    requestItemParentIndex: index("material_request_item_parent_idx").on(table.requestId),
  }),
);

/** Stock is computed only from rows whose status is Posted; there is no editable on-hand field. */
export const inventoryMovements = mysqlTable(
  "inventory_movements",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 })
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: varchar("siteId", { length: 36 }).notNull(),
    materialItemId: varchar("materialItemId", { length: 36 }).notNull(),
    movementType: mysqlEnum("movementType", [
      "Receipt/Inward",
      "Issue/Consumption",
      "Return to Store",
      "Wastage",
      "Damage",
    ]).notNull(),
    direction: mysqlEnum("direction", ["Inbound", "Outbound"]).notNull(),
    quantity: decimal("quantity", { precision: 14, scale: 3 }).notNull(),
    unitCode: varchar("unitCode", { length: 32 }).notNull(),
    sourceReference: varchar("sourceReference", { length: 180 }),
    reason: text("reason").notNull(),
    status: mysqlEnum("status", ["Submitted", "Posted", "Rejected"]).default("Submitted").notNull(),
    createdBy: int("createdBy")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reviewedBy: int("reviewedBy").references(() => users.id, { onDelete: "restrict" }),
    reviewedAt: timestamp("reviewedAt"),
    reviewNote: text("reviewNote"),
    postedBy: int("postedBy").references(() => users.id, { onDelete: "restrict" }),
    postedAt: timestamp("postedAt"),
    clientMutationId: varchar("clientMutationId", { length: 64 }).notNull().unique(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    movementOrganizationIdUnique: uniqueIndex("inventory_move_org_id_uq").on(
      table.organizationId,
      table.id,
    ),
    movementSiteStatusIndex: index("inventory_move_site_status_idx").on(
      table.organizationId,
      table.siteId,
      table.status,
      table.createdAt,
    ),
    movementItemBalanceIndex: index("inventory_move_item_balance_idx").on(
      table.organizationId,
      table.siteId,
      table.materialItemId,
      table.status,
    ),
    movementSiteSameOrganization: foreignKey({
      name: "inventory_move_site_same_org_fk",
      columns: [table.organizationId, table.siteId],
      foreignColumns: [sites.organizationId, sites.id],
    }).onDelete("restrict"),
    movementItemSameOrganization: foreignKey({
      name: "inventory_move_item_same_org_fk",
      columns: [table.organizationId, table.materialItemId],
      foreignColumns: [materialItems.organizationId, materialItems.id],
    }).onDelete("restrict"),
  }),
);

/** Organisation-wide supplier identities; raw bank/payment credentials are intentionally not stored here. */
export const vendors = mysqlTable(
  "vendors",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 })
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    vendorType: mysqlEnum("vendorType", [
      "Material Supplier",
      "Transporter",
      "Subcontractor",
      "Service Provider",
      "Other",
    ])
      .default("Other")
      .notNull(),
    legalName: varchar("legalName", { length: 180 }).notNull(),
    tradeName: varchar("tradeName", { length: 180 }),
    contactName: varchar("contactName", { length: 120 }),
    phone: varchar("phone", { length: 40 }),
    email: varchar("email", { length: 254 }),
    address: text("address"),
    paymentTermsDays: int("paymentTermsDays"),
    status: mysqlEnum("status", ["Active", "Inactive"]).default("Active").notNull(),
    clientMutationId: varchar("clientMutationId", { length: 64 }).notNull().unique(),
    createdBy: int("createdBy")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    vendorOrganizationIdUnique: uniqueIndex("vendor_org_id_uq").on(table.organizationId, table.id),
    vendorOrganizationStatusIndex: index("vendor_org_status_idx").on(
      table.organizationId,
      table.status,
      table.legalName,
    ),
  }),
);

/** Invoice balances are not stored; this table records supplier-submitted amounts and review state only. */
export const supplierInvoices = mysqlTable(
  "supplier_invoices",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 })
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: varchar("siteId", { length: 36 }).notNull(),
    vendorId: varchar("vendorId", { length: 36 }).notNull(),
    invoiceNumber: varchar("invoiceNumber", { length: 80 }).notNull(),
    invoiceNumberKey: varchar("invoiceNumberKey", { length: 80 }).notNull(),
    invoiceDate: date("invoiceDate", { mode: "string" }).notNull(),
    dueDate: date("dueDate", { mode: "string" }),
    currency: varchar("currency", { length: 3 }).default("INR").notNull(),
    subtotalMinor: decimal("subtotalMinor", { precision: 18, scale: 0, mode: "string" }).notNull(),
    taxMinor: decimal("taxMinor", { precision: 18, scale: 0, mode: "string" }).notNull(),
    chargesMinor: decimal("chargesMinor", { precision: 18, scale: 0, mode: "string" }).notNull(),
    totalMinor: decimal("totalMinor", { precision: 18, scale: 0, mode: "string" }).notNull(),
    purchaseReference: varchar("purchaseReference", { length: 120 }),
    receiptReference: varchar("receiptReference", { length: 120 }),
    status: mysqlEnum("status", ["Draft", "Submitted", "Approved", "Rejected", "Disputed"])
      .default("Draft")
      .notNull(),
    createdBy: int("createdBy")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    submittedBy: int("submittedBy").references(() => users.id, { onDelete: "restrict" }),
    submittedAt: timestamp("submittedAt"),
    reviewedBy: int("reviewedBy").references(() => users.id, { onDelete: "restrict" }),
    reviewedAt: timestamp("reviewedAt"),
    reviewReason: text("reviewReason"),
    clientMutationId: varchar("clientMutationId", { length: 64 }).notNull().unique(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    invoiceOrganizationIdUnique: uniqueIndex("supplier_invoice_org_id_uq").on(
      table.organizationId,
      table.id,
    ),
    invoicePaymentScopeUnique: uniqueIndex("supplier_invoice_payment_scope_uq").on(
      table.organizationId,
      table.siteId,
      table.vendorId,
      table.id,
    ),
    invoiceNumberPerVendorUnique: uniqueIndex("supplier_invoice_vendor_number_uq").on(
      table.organizationId,
      table.vendorId,
      table.invoiceNumberKey,
    ),
    invoiceSiteStatusIndex: index("supplier_invoice_site_status_idx").on(
      table.organizationId,
      table.siteId,
      table.status,
      table.invoiceDate,
    ),
    invoiceVendorDateIndex: index("supplier_invoice_vendor_date_idx").on(
      table.organizationId,
      table.vendorId,
      table.invoiceDate,
    ),
    invoiceSiteSameOrganization: foreignKey({
      name: "supplier_invoice_site_same_org_fk",
      columns: [table.organizationId, table.siteId],
      foreignColumns: [sites.organizationId, sites.id],
    }).onDelete("restrict"),
    invoiceVendorSameOrganization: foreignKey({
      name: "supplier_invoice_vendor_same_org_fk",
      columns: [table.organizationId, table.vendorId],
      foreignColumns: [vendors.organizationId, vendors.id],
    }).onDelete("restrict"),
  }),
);

export const supplierInvoiceLines = mysqlTable(
  "supplier_invoice_lines",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    invoiceId: varchar("invoiceId", { length: 36 })
      .notNull()
      .references(() => supplierInvoices.id, { onDelete: "restrict" }),
    description: varchar("description", { length: 240 }).notNull(),
    quantity: decimal("quantity", { precision: 14, scale: 3, mode: "string" }).notNull(),
    unitCode: varchar("unitCode", { length: 32 }).notNull(),
    lineTotalMinor: decimal("lineTotalMinor", {
      precision: 18,
      scale: 0,
      mode: "string",
    }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    invoiceLineParentIndex: index("supplier_invoice_line_parent_idx").on(table.invoiceId),
  }),
);

/** Posted status means an internal JP Infracon ledger record, not provider-verified money movement. */
export const supplierPayments = mysqlTable(
  "supplier_payments",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 })
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: varchar("siteId", { length: 36 }).notNull(),
    vendorId: varchar("vendorId", { length: 36 }).notNull(),
    transactionType: mysqlEnum("transactionType", [
      "Supplier Invoice Payment",
      "Supplier Advance",
      "Transporter Freight",
      "Supplier Refund",
      "Other",
    ])
      .default("Supplier Invoice Payment")
      .notNull(),
    direction: mysqlEnum("direction", ["Outflow", "Inflow"]).default("Outflow").notNull(),
    amountMinor: decimal("amountMinor", { precision: 18, scale: 0, mode: "string" }).notNull(),
    currency: varchar("currency", { length: 3 }).default("INR").notNull(),
    paymentDate: date("paymentDate", { mode: "string" }).notNull(),
    paymentMode: mysqlEnum("paymentMode", [
      "Bank Transfer",
      "UPI",
      "Cheque",
      "Cash",
      "Other",
    ]).notNull(),
    beneficiaryNameSnapshot: varchar("beneficiaryNameSnapshot", { length: 180 }).notNull(),
    paidByName: varchar("paidByName", { length: 180 }).notNull(),
    fundingSourceLabel: varchar("fundingSourceLabel", { length: 180 }).notNull(),
    category: varchar("category", { length: 80 }).notNull(),
    purpose: varchar("purpose", { length: 500 }).notNull(),
    externalReference: varchar("externalReference", { length: 120 }),
    status: mysqlEnum("status", [
      "Draft",
      "Submitted",
      "Approved",
      "Rejected",
      "Cancelled",
      "Posted",
      "Reversed",
    ])
      .default("Draft")
      .notNull(),
    createdBy: int("createdBy")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    submittedBy: int("submittedBy").references(() => users.id, { onDelete: "restrict" }),
    submittedAt: timestamp("submittedAt"),
    reviewedBy: int("reviewedBy").references(() => users.id, { onDelete: "restrict" }),
    reviewedAt: timestamp("reviewedAt"),
    reviewReason: text("reviewReason"),
    postedBy: int("postedBy").references(() => users.id, { onDelete: "restrict" }),
    postedAt: timestamp("postedAt"),
    cancelledBy: int("cancelledBy").references(() => users.id, { onDelete: "restrict" }),
    cancelledAt: timestamp("cancelledAt"),
    cancellationReason: text("cancellationReason"),
    clientMutationId: varchar("clientMutationId", { length: 64 }).notNull().unique(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    paymentOrganizationIdUnique: uniqueIndex("supplier_payment_org_id_uq").on(
      table.organizationId,
      table.id,
    ),
    paymentScopeVendorIdUnique: uniqueIndex("supplier_payment_scope_vendor_id_uq").on(
      table.organizationId,
      table.siteId,
      table.vendorId,
      table.id,
    ),
    paymentSiteStatusIndex: index("supplier_payment_site_status_idx").on(
      table.organizationId,
      table.siteId,
      table.status,
      table.paymentDate,
    ),
    paymentVendorDateIndex: index("supplier_payment_vendor_date_idx").on(
      table.organizationId,
      table.vendorId,
      table.paymentDate,
    ),
    paymentSiteSameOrganization: foreignKey({
      name: "supplier_payment_site_same_org_fk",
      columns: [table.organizationId, table.siteId],
      foreignColumns: [sites.organizationId, sites.id],
    }).onDelete("restrict"),
    paymentVendorSameOrganization: foreignKey({
      name: "supplier_payment_vendor_same_org_fk",
      columns: [table.organizationId, table.vendorId],
      foreignColumns: [vendors.organizationId, vendors.id],
    }).onDelete("restrict"),
  }),
);

/** Immutable invoice-level allocations; only allocations whose payment is Posted affect invoice balance. */
export const supplierPaymentAllocations = mysqlTable(
  "supplier_payment_allocations",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 }).notNull(),
    siteId: varchar("siteId", { length: 36 }).notNull(),
    vendorId: varchar("vendorId", { length: 36 }).notNull(),
    paymentId: varchar("paymentId", { length: 36 }).notNull(),
    invoiceId: varchar("invoiceId", { length: 36 }).notNull(),
    amountMinor: decimal("amountMinor", { precision: 18, scale: 0, mode: "string" }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    paymentInvoiceUnique: uniqueIndex("supplier_payment_invoice_allocation_uq").on(
      table.paymentId,
      table.invoiceId,
    ),
    allocationPaymentIndex: index("supplier_payment_allocation_payment_idx").on(
      table.organizationId,
      table.siteId,
      table.paymentId,
    ),
    allocationInvoiceIndex: index("supplier_payment_allocation_invoice_idx").on(
      table.organizationId,
      table.siteId,
      table.invoiceId,
    ),
    allocationSamePaymentScope: foreignKey({
      name: "supplier_payment_allocation_payment_scope_fk",
      columns: [table.organizationId, table.siteId, table.vendorId, table.paymentId],
      foreignColumns: [
        supplierPayments.organizationId,
        supplierPayments.siteId,
        supplierPayments.vendorId,
        supplierPayments.id,
      ],
    }).onDelete("restrict"),
    allocationSameInvoiceScope: foreignKey({
      name: "supplier_payment_allocation_invoice_scope_fk",
      columns: [table.organizationId, table.siteId, table.vendorId, table.invoiceId],
      foreignColumns: [
        supplierInvoices.organizationId,
        supplierInvoices.siteId,
        supplierInvoices.vendorId,
        supplierInvoices.id,
      ],
    }).onDelete("restrict"),
  }),
);

/** Cash-fund balance is derived from Posted pettyCashMovements; it is never stored or overridden. */
export const pettyCashFunds = mysqlTable(
  "petty_cash_funds",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 })
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: varchar("siteId", { length: 36 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    nameKey: varchar("nameKey", { length: 120 }).notNull(),
    custodianUserId: int("custodianUserId")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    custodianNameSnapshot: varchar("custodianNameSnapshot", { length: 180 }).notNull(),
    authorizedLimitMinor: decimal("authorizedLimitMinor", {
      precision: 18,
      scale: 0,
      mode: "string",
    }).notNull(),
    reconciliationPeriod: mysqlEnum("reconciliationPeriod", [
      "Weekly",
      "Fortnightly",
      "Monthly",
      "Quarterly",
    ]).notNull(),
    status: mysqlEnum("status", ["Pending Custodian", "Active", "On Hold", "Closed"])
      .default("Pending Custodian")
      .notNull(),
    custodianAcknowledgedBy: int("custodianAcknowledgedBy").references(() => users.id, {
      onDelete: "restrict",
    }),
    custodianAcknowledgedAt: timestamp("custodianAcknowledgedAt"),
    createdBy: int("createdBy")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    clientMutationId: varchar("clientMutationId", { length: 64 }).notNull().unique(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    pettyCashFundOrganizationIdUnique: uniqueIndex("petty_cash_fund_org_id_uq").on(
      table.organizationId,
      table.id,
    ),
    pettyCashFundScopeUnique: uniqueIndex("petty_cash_fund_org_site_id_uq").on(
      table.organizationId,
      table.siteId,
      table.id,
    ),
    pettyCashFundNameUnique: uniqueIndex("petty_cash_fund_site_name_uq").on(
      table.organizationId,
      table.siteId,
      table.nameKey,
    ),
    pettyCashFundSiteSameOrganization: foreignKey({
      name: "petty_cash_fund_site_same_org_fk",
      columns: [table.organizationId, table.siteId],
      foreignColumns: [sites.organizationId, sites.id],
    }).onDelete("restrict"),
  }),
);

/** All movements are append-and-transition records; Posted entries alone affect derived cash. */
export const pettyCashMovements = mysqlTable(
  "petty_cash_movements",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 }).notNull(),
    siteId: varchar("siteId", { length: 36 }).notNull(),
    fundId: varchar("fundId", { length: 36 }).notNull(),
    movementType: mysqlEnum("movementType", ["Funding", "Expense", "Cash Return"]).notNull(),
    amountMinor: decimal("amountMinor", { precision: 18, scale: 0, mode: "string" }).notNull(),
    currency: varchar("currency", { length: 3 }).default("INR").notNull(),
    movementDate: date("movementDate", { mode: "string" }).notNull(),
    paymentMode: mysqlEnum("paymentMode", [
      "Cash",
      "UPI",
      "Bank Transfer",
      "Cheque",
      "Card",
      "Other",
    ]).notNull(),
    payeeName: varchar("payeeName", { length: 180 }).notNull(),
    paidByName: varchar("paidByName", { length: 180 }).notNull(),
    sourceAccountLabel: varchar("sourceAccountLabel", { length: 180 }).notNull(),
    expenseFundingSource: mysqlEnum("expenseFundingSource", ["Site Petty Cash"]),
    fundSourceAttestation: mysqlEnum("fundSourceAttestation", ["Not Applicable", "Confirmed"])
      .default("Not Applicable")
      .notNull(),
    category: varchar("category", { length: 80 }).notNull(),
    purpose: text("purpose").notNull(),
    taskId: varchar("taskId", { length: 36 }),
    taskCodeSnapshot: varchar("taskCodeSnapshot", { length: 64 }),
    taskTitleSnapshot: varchar("taskTitleSnapshot", { length: 180 }),
    taskStatusSnapshot: varchar("taskStatusSnapshot", { length: 64 }),
    relatedMovementId: varchar("relatedMovementId", { length: 36 }),
    receiptReference: varchar("receiptReference", { length: 160 }),
    receiptMissingReason: text("receiptMissingReason"),
    status: mysqlEnum("status", [
      "Draft",
      "Submitted",
      "Approved",
      "Rejected",
      "Cancelled",
      "Posted",
    ])
      .default("Draft")
      .notNull(),
    createdBy: int("createdBy")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    submittedBy: int("submittedBy").references(() => users.id, { onDelete: "restrict" }),
    submittedAt: timestamp("submittedAt"),
    reviewedBy: int("reviewedBy").references(() => users.id, { onDelete: "restrict" }),
    reviewedAt: timestamp("reviewedAt"),
    reviewReason: text("reviewReason"),
    postedBy: int("postedBy").references(() => users.id, { onDelete: "restrict" }),
    postedAt: timestamp("postedAt"),
    cancelledBy: int("cancelledBy").references(() => users.id, { onDelete: "restrict" }),
    cancelledAt: timestamp("cancelledAt"),
    cancellationReason: text("cancellationReason"),
    clientMutationId: varchar("clientMutationId", { length: 64 }).notNull().unique(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    pettyCashMovementScopeUnique: uniqueIndex("petty_cash_movement_org_site_fund_id_uq").on(
      table.organizationId,
      table.siteId,
      table.fundId,
      table.id,
    ),
    pettyCashMovementFundStatusDateIndex: index("petty_cash_movement_fund_status_date_idx").on(
      table.organizationId,
      table.siteId,
      table.fundId,
      table.status,
      table.movementDate,
    ),
    pettyCashMovementSiteStatusDateIndex: index("petty_cash_movement_site_status_date_idx").on(
      table.organizationId,
      table.siteId,
      table.status,
      table.movementDate,
    ),
    pettyCashMovementRelatedIndex: index("petty_cash_movement_related_idx").on(
      table.organizationId,
      table.siteId,
      table.fundId,
      table.relatedMovementId,
    ),
    pettyCashMovementFundScope: foreignKey({
      name: "petty_cash_movement_fund_scope_fk",
      columns: [table.organizationId, table.siteId, table.fundId],
      foreignColumns: [pettyCashFunds.organizationId, pettyCashFunds.siteId, pettyCashFunds.id],
    }).onDelete("restrict"),
    pettyCashMovementTaskScope: foreignKey({
      name: "petty_cash_movement_task_scope_fk",
      columns: [table.siteId, table.taskId],
      foreignColumns: [workTasks.siteId, workTasks.id],
    }).onDelete("restrict"),
  }),
);

export const attachments = mysqlTable(
  "attachments",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 })
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    entityType: varchar("entityType", { length: 64 }).notNull(),
    entityId: varchar("entityId", { length: 36 }).notNull(),
    storageKey: varchar("storageKey", { length: 240 }).notNull().unique(),
    originalFilename: varchar("originalFilename", { length: 240 }).notNull(),
    contentType: varchar("contentType", { length: 120 }).notNull(),
    sizeBytes: int("sizeBytes").notNull(),
    checksum: varchar("checksum", { length: 128 }),
    uploadedBy: int("uploadedBy")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    uploadedAt: timestamp("uploadedAt").defaultNow().notNull(),
    captureTime: timestamp("captureTime"),
    sourceType: mysqlEnum("sourceType", [
      "Captured in app",
      "Selected from device",
      "Imported",
    ]).notNull(),
    accessClassification: mysqlEnum("accessClassification", ["Private", "Restricted"])
      .default("Private")
      .notNull(),
    scanStatus: mysqlEnum("scanStatus", ["Pending", "Accepted", "Rejected"])
      .default("Pending")
      .notNull(),
  },
  (table) => ({
    attachmentEntityIndex: index("attachment_entity_idx").on(
      table.organizationId,
      table.entityType,
      table.entityId,
    ),
  }),
);

/** Application write paths only INSERT audit rows; there are no update/delete procedures. */
export const auditEvents = mysqlTable(
  "audit_events",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 })
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: varchar("siteId", { length: 36 }).references(() => sites.id, { onDelete: "restrict" }),
    actorUserId: int("actorUserId")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    action: varchar("action", { length: 96 }).notNull(),
    entityType: varchar("entityType", { length: 64 }).notNull(),
    entityId: varchar("entityId", { length: 36 }).notNull(),
    occurredAt: timestamp("occurredAt").defaultNow().notNull(),
    requestId: varchar("requestId", { length: 100 }),
    clientMutationId: varchar("clientMutationId", { length: 64 }),
    beforeSummary: text("beforeSummary"),
    afterSummary: text("afterSummary"),
    reason: text("reason"),
  },
  (table) => ({
    auditOrgTimeIndex: index("audit_org_time_idx").on(table.organizationId, table.occurredAt),
    auditSiteTimeIndex: index("audit_site_time_idx").on(table.siteId, table.occurredAt),
    auditActorMutationUnique: uniqueIndex("audit_actor_client_mutation_uq").on(
      table.actorUserId,
      table.clientMutationId,
    ),
    auditEntityIndex: index("audit_entity_idx").on(table.entityType, table.entityId),
  }),
);
