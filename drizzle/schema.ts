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
import { issueCategories } from "../lib/jp/issue-policy";

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
    /** Cover photo: one of the project's own attachments (entityType "project"). */
    coverAttachmentId: varchar("coverAttachmentId", { length: 36 }),
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
    /** Cover photo: one of the site's own attachments (entityType "site"). */
    coverAttachmentId: varchar("coverAttachmentId", { length: 36 }),
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
    // A DPR and a DLR for the same site, day and shift are separate records.
    reportRevisionUnique: uniqueIndex("daily_report_site_kind_date_shift_revision_uq").on(
      table.siteId,
      table.reportKind,
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

/** Safety, quality and site-constraint issues. Status is set by the server; history is append-only. */
export const siteIssues = mysqlTable(
  "site_issues",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 })
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: varchar("siteId", { length: 36 })
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    issueCode: varchar("issueCode", { length: 48 }).notNull(),
    category: mysqlEnum("category", issueCategories).notNull(),
    severity: mysqlEnum("severity", ["Low", "Medium", "High", "Critical"]).notNull(),
    title: varchar("title", { length: 180 }).notNull(),
    description: text("description").notNull(),
    locationLabel: varchar("locationLabel", { length: 180 }),
    immediateAction: text("immediateAction"),
    stopWork: mysqlEnum("stopWork", ["No", "Yes"]).default("No").notNull(),
    observedAt: timestamp("observedAt").notNull(),
    status: mysqlEnum("status", ["Open", "In Progress", "Resolved", "Closed"])
      .default("Open")
      .notNull(),
    ownerUserId: int("ownerUserId").references(() => users.id, { onDelete: "restrict" }),
    ownerNameSnapshot: varchar("ownerNameSnapshot", { length: 180 }),
    targetDate: date("targetDate", { mode: "string" }),
    correctiveAction: text("correctiveAction"),
    preventiveAction: text("preventiveAction"),
    closureNote: text("closureNote"),
    raisedBy: int("raisedBy")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    resolvedBy: int("resolvedBy").references(() => users.id, { onDelete: "restrict" }),
    resolvedAt: timestamp("resolvedAt"),
    closedBy: int("closedBy").references(() => users.id, { onDelete: "restrict" }),
    closedAt: timestamp("closedAt"),
    reopenCount: int("reopenCount").default(0).notNull(),
    recordVersion: int("recordVersion").default(1).notNull(),
    clientMutationId: varchar("clientMutationId", { length: 64 }).notNull().unique(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    issueCodeUnique: uniqueIndex("site_issue_org_code_uq").on(
      table.organizationId,
      table.issueCode,
    ),
    issueSiteStatusIndex: index("site_issue_site_status_idx").on(
      table.siteId,
      table.status,
      table.severity,
    ),
    issueOwnerIndex: index("site_issue_owner_idx").on(table.ownerUserId, table.status),
  }),
);

export const siteIssueEvents = mysqlTable(
  "site_issue_events",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    issueId: varchar("issueId", { length: 36 })
      .notNull()
      .references(() => siteIssues.id, { onDelete: "restrict" }),
    organizationId: varchar("organizationId", { length: 36 }).notNull(),
    siteId: varchar("siteId", { length: 36 }).notNull(),
    eventType: mysqlEnum("eventType", [
      "Raised",
      "Comment",
      "Assigned",
      "Status Changed",
      "Reopened",
    ]).notNull(),
    fromStatus: varchar("fromStatus", { length: 32 }),
    toStatus: varchar("toStatus", { length: 32 }),
    note: text("note"),
    actorUserId: int("actorUserId")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    issueEventIndex: index("site_issue_event_issue_idx").on(table.issueId, table.createdAt),
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

/** One-time sign-up codes an administrator issues so a named person can create their own login. */
export const registrationInvites = mysqlTable(
  "registration_invites",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 })
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    codeHash: varchar("codeHash", { length: 64 }).notNull().unique(),
    codeHint: varchar("codeHint", { length: 8 }).notNull(),
    inviteeName: varchar("inviteeName", { length: 120 }).notNull(),
    businessRole: mysqlEnum("businessRole", [
      "director",
      "admin",
      "project_manager",
      "supervisor",
      "accounts",
      "storekeeper",
      "auditor",
    ]).notNull(),
    siteId: varchar("siteId", { length: 36 }).references(() => sites.id, { onDelete: "restrict" }),
    status: mysqlEnum("status", ["Active", "Used", "Revoked"]).default("Active").notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    createdBy: int("createdBy")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    usedBy: int("usedBy").references(() => users.id, { onDelete: "restrict" }),
    usedAt: timestamp("usedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    inviteOrgStatusIndex: index("registration_invite_org_status_idx").on(
      table.organizationId,
      table.status,
    ),
  }),
);

/** Expo push tokens per signed-in device. */
export const pushDevices = mysqlTable(
  "push_devices",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    expoPushToken: varchar("expoPushToken", { length: 255 }).notNull().unique(),
    platform: varchar("platform", { length: 16 }).notNull(),
    status: mysqlEnum("status", ["Active", "Disabled"]).default("Active").notNull(),
    lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    pushDeviceUserIndex: index("push_device_user_idx").on(table.userId, table.status),
  }),
);

/** Delivery log for push/WhatsApp/SMS alerts. Message bodies are not stored. */
export const notificationDeliveries = mysqlTable(
  "notification_deliveries",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 }).notNull(),
    siteId: varchar("siteId", { length: 36 }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    channel: mysqlEnum("channel", ["push", "whatsapp", "sms"]).notNull(),
    eventKind: varchar("eventKind", { length: 64 }).notNull(),
    status: mysqlEnum("status", ["Sent", "Failed", "Skipped"]).notNull(),
    detail: varchar("detail", { length: 255 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    deliveryUserTimeIndex: index("notification_delivery_user_time_idx").on(
      table.userId,
      table.createdAt,
    ),
  }),
);

/** Arrival/departure at a site geofence, recorded only for people who opted in on their phone. */
export const sitePresenceEvents = mysqlTable(
  "site_presence_events",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 }).notNull(),
    siteId: varchar("siteId", { length: 36 })
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    eventType: mysqlEnum("eventType", ["Arrived", "Left"]).notNull(),
    latitude: decimal("latitude", { precision: 9, scale: 6 }),
    longitude: decimal("longitude", { precision: 9, scale: 6 }),
    accuracyM: int("accuracyM"),
    occurredAt: timestamp("occurredAt").notNull(),
    clientMutationId: varchar("clientMutationId", { length: 64 }).notNull().unique(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    presenceSiteTimeIndex: index("site_presence_site_time_idx").on(table.siteId, table.occurredAt),
  }),
);

/** Contact and alert preferences, kept apart from `users` so older code paths never depend on them. */
export const userContactPreferences = mysqlTable("user_contact_preferences", {
  userId: int("userId")
    .primaryKey()
    .references(() => users.id, { onDelete: "restrict" }),
  /** E.164 mobile number for WhatsApp/SMS alerts; used only when the person opts in. */
  phone: varchar("phone", { length: 20 }),
  whatsappOptIn: mysqlEnum("whatsappOptIn", ["No", "Yes"]).default("No").notNull(),
  smsOptIn: mysqlEnum("smsOptIn", ["No", "Yes"]).default("No").notNull(),
  pushOptIn: mysqlEnum("pushOptIn", ["No", "Yes"]).default("Yes").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Site boundary used for arrival/departure alerts and GPS photo checks. */
export const siteGeofences = mysqlTable("site_geofences", {
  siteId: varchar("siteId", { length: 36 })
    .primaryKey()
    .references(() => sites.id, { onDelete: "restrict" }),
  latitude: decimal("latitude", { precision: 9, scale: 6 }).notNull(),
  longitude: decimal("longitude", { precision: 9, scale: 6 }).notNull(),
  radiusM: int("radiusM").notNull(),
  setBy: int("setBy")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Where an evidence photo was taken, when the phone shared its location. */
export const attachmentLocations = mysqlTable("attachment_locations", {
  attachmentId: varchar("attachmentId", { length: 36 })
    .primaryKey()
    .references(() => attachments.id, { onDelete: "restrict" }),
  latitude: decimal("latitude", { precision: 9, scale: 6 }).notNull(),
  longitude: decimal("longitude", { precision: 9, scale: 6 }).notNull(),
  accuracyM: int("accuracyM"),
  distanceFromSiteM: int("distanceFromSiteM"),
  capturedAt: timestamp("capturedAt").notNull(),
});

/** A time-limited handover of authority from an administrator to a named person. */
export const delegations = mysqlTable(
  "delegations",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 })
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    scopeType: mysqlEnum("scopeType", ["project", "site"]).notNull(),
    scopeId: varchar("scopeId", { length: 36 }).notNull(),
    bundles: varchar("bundles", { length: 120 }).notNull(),
    reason: text("reason").notNull(),
    effectiveFrom: timestamp("effectiveFrom").notNull(),
    effectiveTo: timestamp("effectiveTo"),
    status: mysqlEnum("status", ["Active", "Revoked"]).default("Active").notNull(),
    grantedBy: int("grantedBy")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    revokedBy: int("revokedBy").references(() => users.id, { onDelete: "restrict" }),
    revokedAt: timestamp("revokedAt"),
    revokeReason: text("revokeReason"),
    clientMutationId: varchar("clientMutationId", { length: 64 }).notNull().unique(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    delegationOrgIndex: index("delegation_org_status_idx").on(table.organizationId, table.status),
    delegationUserIndex: index("delegation_user_idx").on(table.userId, table.status),
  }),
);

/** Links each delegation to the permission grants it created, so revoking one revokes them all. */
export const delegationGrants = mysqlTable(
  "delegation_grants",
  {
    delegationId: varchar("delegationId", { length: 36 })
      .notNull()
      .references(() => delegations.id, { onDelete: "restrict" }),
    grantId: varchar("grantId", { length: 36 })
      .notNull()
      .references(() => permissionGrants.id, { onDelete: "restrict" }),
  },
  (table) => ({
    delegationGrantUnique: uniqueIndex("delegation_grant_uq").on(table.delegationId, table.grantId),
  }),
);

/**
 * A project document (contract, drawing, BOQ, bill, approval, photo…). The file itself is an
 * `attachments` row per version; this row holds what people search and filter by.
 */
export const projectDocuments = mysqlTable(
  "project_documents",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 })
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    projectId: varchar("projectId", { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    /** Null for a project-wide document; set when it belongs to one site. */
    siteId: varchar("siteId", { length: 36 }).references(() => sites.id, { onDelete: "restrict" }),
    category: varchar("category", { length: 64 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    description: text("description"),
    tags: varchar("tags", { length: 500 }),
    currentVersion: int("currentVersion").default(1).notNull(),
    status: mysqlEnum("status", ["Active", "Archived"]).default("Active").notNull(),
    /** What the AI reader found; suggestions only, never used for money or approvals. */
    aiDocumentType: varchar("aiDocumentType", { length: 80 }),
    aiSummary: text("aiSummary"),
    aiFields: text("aiFields"),
    indexStatus: mysqlEnum("indexStatus", ["Pending", "Indexed", "Keyword only", "Failed"])
      .default("Pending")
      .notNull(),
    clientMutationId: varchar("clientMutationId", { length: 64 }).notNull().unique(),
    createdBy: int("createdBy")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    documentProjectIndex: index("project_document_project_idx").on(
      table.organizationId,
      table.projectId,
      table.status,
    ),
    documentSiteIndex: index("project_document_site_idx").on(table.siteId),
  }),
);

/** Every uploaded file of a document, kept when it is replaced. */
export const projectDocumentVersions = mysqlTable(
  "project_document_versions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    documentId: varchar("documentId", { length: 36 })
      .notNull()
      .references(() => projectDocuments.id, { onDelete: "restrict" }),
    versionNumber: int("versionNumber").notNull(),
    attachmentId: varchar("attachmentId", { length: 36 })
      .notNull()
      .references(() => attachments.id, { onDelete: "restrict" }),
    note: varchar("note", { length: 500 }),
    uploadedBy: int("uploadedBy")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    documentVersionUnique: uniqueIndex("project_document_version_uq").on(
      table.documentId,
      table.versionNumber,
    ),
  }),
);

/**
 * Search passages of a document's current version: text for keyword matching and, when an AI
 * key is set, an embedding (JSON array) for meaning search. Rebuilt when a version is added.
 */
export const documentChunks = mysqlTable(
  "document_chunks",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    documentId: varchar("documentId", { length: 36 })
      .notNull()
      .references(() => projectDocuments.id, { onDelete: "restrict" }),
    versionNumber: int("versionNumber").notNull(),
    chunkIndex: int("chunkIndex").notNull(),
    content: text("content").notNull(),
    embedding: text("embedding"),
    embeddingModel: varchar("embeddingModel", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    chunkDocumentIndex: index("document_chunk_document_idx").on(table.documentId, table.chunkIndex),
  }),
);

/**
 * A project budget revision. Each change is a new revision: proposed by one person, approved
 * or rejected by another. The approved revision is the current budget; older approved ones
 * become Superseded. Totals are set by the server from the lines.
 */
export const projectBudgets = mysqlTable(
  "project_budgets",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 })
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    projectId: varchar("projectId", { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    revisionNumber: int("revisionNumber").notNull(),
    status: mysqlEnum("status", ["Proposed", "Approved", "Rejected", "Superseded"])
      .default("Proposed")
      .notNull(),
    /** Agreement value with the client, when recorded. */
    contractValueMinor: decimal("contractValueMinor", { precision: 18, scale: 0, mode: "string" }),
    totalMinor: decimal("totalMinor", { precision: 18, scale: 0, mode: "string" }).notNull(),
    currency: varchar("currency", { length: 3 }).default("INR").notNull(),
    reason: text("reason"),
    proposedBy: int("proposedBy")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reviewedBy: int("reviewedBy").references(() => users.id, { onDelete: "restrict" }),
    reviewedAt: timestamp("reviewedAt"),
    reviewReason: text("reviewReason"),
    clientMutationId: varchar("clientMutationId", { length: 64 }).notNull().unique(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    budgetRevisionUnique: uniqueIndex("project_budget_revision_uq").on(
      table.projectId,
      table.revisionNumber,
    ),
    budgetProjectStatusIndex: index("project_budget_project_status_idx").on(
      table.projectId,
      table.status,
    ),
  }),
);

/** Amount per cost head in one budget revision. */
export const projectBudgetLines = mysqlTable(
  "project_budget_lines",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    budgetId: varchar("budgetId", { length: 36 })
      .notNull()
      .references(() => projectBudgets.id, { onDelete: "restrict" }),
    costHead: varchar("costHead", { length: 64 }).notNull(),
    amountMinor: decimal("amountMinor", { precision: 18, scale: 0, mode: "string" }).notNull(),
    note: varchar("note", { length: 300 }),
  },
  (table) => ({
    budgetLineHeadUnique: uniqueIndex("project_budget_line_head_uq").on(
      table.budgetId,
      table.costHead,
    ),
  }),
);

/**
 * A person's own profile: work details and a photo. The mobile number for alerts stays in
 * user_contact_preferences so there is one place for it.
 */
export const userProfiles = mysqlTable("user_profiles", {
  userId: int("userId")
    .primaryKey()
    .references(() => users.id, { onDelete: "restrict" }),
  designation: varchar("designation", { length: 120 }),
  department: varchar("department", { length: 120 }),
  addressLine: varchar("addressLine", { length: 300 }),
  city: varchar("city", { length: 120 }),
  district: varchar("district", { length: 120 }),
  state: varchar("state", { length: 120 }),
  pincode: varchar("pincode", { length: 10 }),
  emergencyContact: varchar("emergencyContact", { length: 160 }),
  photoStorageKey: varchar("photoStorageKey", { length: 240 }),
  photoContentType: varchar("photoContentType", { length: 64 }),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Company-wide settings, such as which optional modules are turned off. */
export const organizationSettings = mysqlTable("organization_settings", {
  organizationId: varchar("organizationId", { length: 36 })
    .primaryKey()
    .references(() => organizations.id, { onDelete: "restrict" }),
  /** JSON array of module keys that are turned off (see lib/jp/modules.ts). */
  disabledModules: text("disabledModules"),
  updatedBy: int("updatedBy").references(() => users.id, { onDelete: "restrict" }),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * Extra details for a worker, technician or subcontractor contact: address, a second phone,
 * and the subcontractor firm (vendor) they belong to, so bills and payments show on their profile.
 */
export const personDetails = mysqlTable("person_details", {
  personId: varchar("personId", { length: 36 })
    .primaryKey()
    .references(() => people.id, { onDelete: "restrict" }),
  organizationId: varchar("organizationId", { length: 36 })
    .notNull()
    .references(() => organizations.id, { onDelete: "restrict" }),
  addressLine: varchar("addressLine", { length: 300 }),
  city: varchar("city", { length: 120 }),
  district: varchar("district", { length: 120 }),
  pincode: varchar("pincode", { length: 10 }),
  alternatePhone: varchar("alternatePhone", { length: 40 }),
  vendorId: varchar("vendorId", { length: 36 }).references(() => vendors.id, {
    onDelete: "restrict",
  }),
  notes: text("notes"),
  updatedBy: int("updatedBy").references(() => users.id, { onDelete: "restrict" }),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * Append-only notes on a person's work: quality ratings, defaults (left the job, bad work),
 * safety and praise. A wrong entry is answered by a new one, never edited.
 */
export const personFeedback = mysqlTable(
  "person_feedback",
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
    kind: mysqlEnum("kind", [
      "Quality",
      "Default",
      "Safety",
      "Praise",
      "Payment dispute",
    ]).notNull(),
    /** 1 to 5 stars; only for Quality entries. */
    rating: int("rating"),
    note: text("note").notNull(),
    recordedBy: int("recordedBy")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    clientMutationId: varchar("clientMutationId", { length: 64 }).notNull().unique(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    personFeedbackPersonIndex: index("person_feedback_person_idx").on(
      table.personId,
      table.createdAt,
    ),
  }),
);

/** Company rule: for one alert category and role, which channels are used (see lib/jp/alert-rules.ts). */
export const alertRules = mysqlTable(
  "alert_rules",
  {
    organizationId: varchar("organizationId", { length: 36 })
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    category: varchar("category", { length: 32 }).notNull(),
    role: varchar("role", { length: 32 }).notNull(),
    push: mysqlEnum("push", ["Yes", "No"]).default("Yes").notNull(),
    whatsapp: mysqlEnum("whatsapp", ["Yes", "No"]).default("Yes").notNull(),
    sms: mysqlEnum("sms", ["Yes", "No"]).default("Yes").notNull(),
    detail: mysqlEnum("detail", ["full", "title"]).default("full").notNull(),
    updatedBy: int("updatedBy").references(() => users.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    alertRuleUnique: uniqueIndex("alert_rule_org_category_role_uq").on(
      table.organizationId,
      table.category,
      table.role,
    ),
  }),
);

/** Alert categories a person muted for themselves. */
export const userAlertMutes = mysqlTable(
  "user_alert_mutes",
  {
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    category: varchar("category", { length: 32 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    userAlertMuteUnique: uniqueIndex("user_alert_mute_uq").on(table.userId, table.category),
  }),
);

/**
 * WhatsApp bot conversation log: each inbound message (deduplicated by WhatsApp id) and each
 * reply. Gives the bot short context and lets admins see what it said.
 */
export const whatsappBotMessages = mysqlTable(
  "whatsapp_bot_messages",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    waMessageId: varchar("waMessageId", { length: 191 }).unique(),
    phone: varchar("phone", { length: 20 }).notNull(),
    userId: int("userId").references(() => users.id, { onDelete: "restrict" }),
    direction: mysqlEnum("direction", ["in", "out"]).notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    whatsappBotPhoneIndex: index("whatsapp_bot_phone_idx").on(table.phone, table.createdAt),
  }),
);

// ---------------------------------------------------------------------------------------------
// CRM and client billing (lib/jp/billing-domain.ts). Money is exact paise in DECIMAL(18,0);
// quantities are thousandths; tax and deduction rates are basis points. Totals are set by the
// server. These are internal records, not GST returns or e-invoices.

export const crmClients = mysqlTable(
  "crm_clients",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 })
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 180 }).notNull(),
    clientType: varchar("clientType", { length: 40 }).notNull(),
    contactPerson: varchar("contactPerson", { length: 120 }),
    phone: varchar("phone", { length: 20 }),
    email: varchar("email", { length: 254 }),
    gstin: varchar("gstin", { length: 15 }),
    address: text("address"),
    status: mysqlEnum("status", ["Active", "Inactive"]).default("Active").notNull(),
    clientMutationId: varchar("clientMutationId", { length: 64 }).notNull().unique(),
    createdBy: int("createdBy")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    crmClientOrgIndex: index("crm_client_org_idx").on(table.organizationId, table.name),
  }),
);

export const crmLeads = mysqlTable(
  "crm_leads",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 })
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    clientId: varchar("clientId", { length: 36 }).references(() => crmClients.id, {
      onDelete: "restrict",
    }),
    title: varchar("title", { length: 180 }).notNull(),
    contactName: varchar("contactName", { length: 120 }),
    phone: varchar("phone", { length: 20 }),
    location: varchar("location", { length: 180 }),
    source: varchar("source", { length: 40 }).notNull(),
    stage: varchar("stage", { length: 32 }).notNull(),
    estimatedValueMinor: decimal("estimatedValueMinor", {
      precision: 18,
      scale: 0,
      mode: "string",
    }),
    ownerUserId: int("ownerUserId").references(() => users.id, { onDelete: "restrict" }),
    nextFollowUpOn: date("nextFollowUpOn", { mode: "string" }),
    lostReason: text("lostReason"),
    projectId: varchar("projectId", { length: 36 }).references(() => projects.id, {
      onDelete: "restrict",
    }),
    clientMutationId: varchar("clientMutationId", { length: 64 }).notNull().unique(),
    createdBy: int("createdBy")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    crmLeadOrgStageIndex: index("crm_lead_org_stage_idx").on(table.organizationId, table.stage),
  }),
);

export const crmActivities = mysqlTable(
  "crm_activities",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 })
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    leadId: varchar("leadId", { length: 36 })
      .notNull()
      .references(() => crmLeads.id, { onDelete: "restrict" }),
    kind: varchar("kind", { length: 32 }).notNull(),
    note: text("note").notNull(),
    stageFrom: varchar("stageFrom", { length: 32 }),
    stageTo: varchar("stageTo", { length: 32 }),
    createdBy: int("createdBy")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    crmActivityLeadIndex: index("crm_activity_lead_idx").on(table.leadId, table.createdAt),
  }),
);

export const quotations = mysqlTable(
  "quotations",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 })
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    clientId: varchar("clientId", { length: 36 })
      .notNull()
      .references(() => crmClients.id, { onDelete: "restrict" }),
    leadId: varchar("leadId", { length: 36 }).references(() => crmLeads.id, {
      onDelete: "restrict",
    }),
    quotationNumber: varchar("quotationNumber", { length: 40 }).notNull(),
    title: varchar("title", { length: 180 }).notNull(),
    status: mysqlEnum("status", ["Draft", "Sent", "Accepted", "Rejected", "Expired"])
      .default("Draft")
      .notNull(),
    quotationDate: date("quotationDate", { mode: "string" }).notNull(),
    validUntil: date("validUntil", { mode: "string" }),
    gstBps: int("gstBps").notNull(),
    subtotalMinor: decimal("subtotalMinor", { precision: 18, scale: 0, mode: "string" }).notNull(),
    gstMinor: decimal("gstMinor", { precision: 18, scale: 0, mode: "string" }).notNull(),
    totalMinor: decimal("totalMinor", { precision: 18, scale: 0, mode: "string" }).notNull(),
    terms: text("terms"),
    projectId: varchar("projectId", { length: 36 }).references(() => projects.id, {
      onDelete: "restrict",
    }),
    clientMutationId: varchar("clientMutationId", { length: 64 }).notNull().unique(),
    createdBy: int("createdBy")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    quotationNumberUnique: uniqueIndex("quotation_org_number_uq").on(
      table.organizationId,
      table.quotationNumber,
    ),
  }),
);

export const quotationLines = mysqlTable("quotation_lines", {
  id: varchar("id", { length: 36 }).primaryKey(),
  quotationId: varchar("quotationId", { length: 36 })
    .notNull()
    .references(() => quotations.id, { onDelete: "restrict" }),
  lineNumber: int("lineNumber").notNull(),
  itemCode: varchar("itemCode", { length: 40 }),
  description: varchar("description", { length: 500 }).notNull(),
  unit: varchar("unit", { length: 20 }).notNull(),
  quantityThousandths: decimal("quantityThousandths", {
    precision: 18,
    scale: 0,
    mode: "string",
  }).notNull(),
  rateMinor: decimal("rateMinor", { precision: 18, scale: 0, mode: "string" }).notNull(),
  amountMinor: decimal("amountMinor", { precision: 18, scale: 0, mode: "string" }).notNull(),
});

/** The client contract on a project: who pays, and the default GST and deductions. */
export const projectContracts = mysqlTable("project_contracts", {
  projectId: varchar("projectId", { length: 36 })
    .primaryKey()
    .references(() => projects.id, { onDelete: "restrict" }),
  organizationId: varchar("organizationId", { length: 36 })
    .notNull()
    .references(() => organizations.id, { onDelete: "restrict" }),
  clientId: varchar("clientId", { length: 36 })
    .notNull()
    .references(() => crmClients.id, { onDelete: "restrict" }),
  contractNumber: varchar("contractNumber", { length: 80 }),
  quotationId: varchar("quotationId", { length: 36 }).references(() => quotations.id, {
    onDelete: "restrict",
  }),
  gstBps: int("gstBps").notNull(),
  retentionBps: int("retentionBps").notNull(),
  tdsBps: int("tdsBps").notNull(),
  updatedBy: int("updatedBy").references(() => users.id, { onDelete: "restrict" }),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Contract items (client BOQ) a project is billed against. */
export const contractItems = mysqlTable(
  "contract_items",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 })
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    projectId: varchar("projectId", { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    itemCode: varchar("itemCode", { length: 40 }).notNull(),
    description: varchar("description", { length: 500 }).notNull(),
    unit: varchar("unit", { length: 20 }).notNull(),
    contractQuantityThousandths: decimal("contractQuantityThousandths", {
      precision: 18,
      scale: 0,
      mode: "string",
    }).notNull(),
    rateMinor: decimal("rateMinor", { precision: 18, scale: 0, mode: "string" }).notNull(),
    status: mysqlEnum("status", ["Active", "Removed"]).default("Active").notNull(),
    createdBy: int("createdBy")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    contractItemCodeUnique: uniqueIndex("contract_item_project_code_uq").on(
      table.projectId,
      table.itemCode,
    ),
  }),
);

export const clientBills = mysqlTable(
  "client_bills",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 })
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    projectId: varchar("projectId", { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    clientId: varchar("clientId", { length: 36 })
      .notNull()
      .references(() => crmClients.id, { onDelete: "restrict" }),
    billNumber: varchar("billNumber", { length: 40 }).notNull(),
    billDate: date("billDate", { mode: "string" }).notNull(),
    periodFrom: date("periodFrom", { mode: "string" }),
    periodTo: date("periodTo", { mode: "string" }),
    status: mysqlEnum("status", ["Draft", "Submitted", "Approved", "Rejected", "Cancelled"])
      .default("Draft")
      .notNull(),
    gstBps: int("gstBps").notNull(),
    retentionBps: int("retentionBps").notNull(),
    tdsBps: int("tdsBps").notNull(),
    workValueMinor: decimal("workValueMinor", {
      precision: 18,
      scale: 0,
      mode: "string",
    }).notNull(),
    gstMinor: decimal("gstMinor", { precision: 18, scale: 0, mode: "string" }).notNull(),
    retentionMinor: decimal("retentionMinor", {
      precision: 18,
      scale: 0,
      mode: "string",
    }).notNull(),
    tdsMinor: decimal("tdsMinor", { precision: 18, scale: 0, mode: "string" }).notNull(),
    otherDeductionMinor: decimal("otherDeductionMinor", {
      precision: 18,
      scale: 0,
      mode: "string",
    }).notNull(),
    otherDeductionNote: varchar("otherDeductionNote", { length: 300 }),
    netReceivableMinor: decimal("netReceivableMinor", {
      precision: 18,
      scale: 0,
      mode: "string",
    }).notNull(),
    reviewReason: text("reviewReason"),
    reviewedBy: int("reviewedBy").references(() => users.id, { onDelete: "restrict" }),
    reviewedAt: timestamp("reviewedAt"),
    clientMutationId: varchar("clientMutationId", { length: 64 }).notNull().unique(),
    createdBy: int("createdBy")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    clientBillNumberUnique: uniqueIndex("client_bill_org_number_uq").on(
      table.organizationId,
      table.billNumber,
    ),
    clientBillProjectIndex: index("client_bill_project_idx").on(table.projectId, table.status),
  }),
);

export const clientBillLines = mysqlTable("client_bill_lines", {
  id: varchar("id", { length: 36 }).primaryKey(),
  billId: varchar("billId", { length: 36 })
    .notNull()
    .references(() => clientBills.id, { onDelete: "restrict" }),
  contractItemId: varchar("contractItemId", { length: 36 }).references(() => contractItems.id, {
    onDelete: "restrict",
  }),
  lineNumber: int("lineNumber").notNull(),
  description: varchar("description", { length: 500 }).notNull(),
  unit: varchar("unit", { length: 20 }).notNull(),
  quantityThousandths: decimal("quantityThousandths", {
    precision: 18,
    scale: 0,
    mode: "string",
  }).notNull(),
  rateMinor: decimal("rateMinor", { precision: 18, scale: 0, mode: "string" }).notNull(),
  amountMinor: decimal("amountMinor", { precision: 18, scale: 0, mode: "string" }).notNull(),
});

/** Money received from a client against an approved bill. A ledger record, not a bank check. */
export const clientReceipts = mysqlTable("client_receipts", {
  id: varchar("id", { length: 36 }).primaryKey(),
  organizationId: varchar("organizationId", { length: 36 })
    .notNull()
    .references(() => organizations.id, { onDelete: "restrict" }),
  billId: varchar("billId", { length: 36 })
    .notNull()
    .references(() => clientBills.id, { onDelete: "restrict" }),
  amountMinor: decimal("amountMinor", { precision: 18, scale: 0, mode: "string" }).notNull(),
  receivedOn: date("receivedOn", { mode: "string" }).notNull(),
  mode: varchar("mode", { length: 32 }).notNull(),
  reference: varchar("reference", { length: 120 }),
  status: mysqlEnum("status", ["Recorded", "Reversed"]).default("Recorded").notNull(),
  reversalReason: text("reversalReason"),
  clientMutationId: varchar("clientMutationId", { length: 64 }).notNull().unique(),
  createdBy: int("createdBy")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ---------------------------------------------------------------------------------------------
// Purchase (lib/jp/purchase-domain.ts): purchase orders with competing quotes, goods receipts
// (GRN) that put accepted material into the inventory ledger, and supplier bills matched to
// the order. Money in paise, quantities in thousandths, GST in basis points.

export const purchaseOrders = mysqlTable(
  "purchase_orders",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 })
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: varchar("siteId", { length: 36 })
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    vendorId: varchar("vendorId", { length: 36 })
      .notNull()
      .references(() => vendors.id, { onDelete: "restrict" }),
    materialRequestId: varchar("materialRequestId", { length: 36 }).references(
      () => materialRequests.id,
      { onDelete: "restrict" },
    ),
    poNumber: varchar("poNumber", { length: 40 }).notNull(),
    status: mysqlEnum("status", [
      "Draft",
      "Submitted",
      "Approved",
      "Rejected",
      "Cancelled",
      "Closed",
    ])
      .default("Draft")
      .notNull(),
    orderDate: date("orderDate", { mode: "string" }).notNull(),
    expectedDate: date("expectedDate", { mode: "string" }),
    deliveryAddress: text("deliveryAddress"),
    terms: text("terms"),
    subtotalMinor: decimal("subtotalMinor", { precision: 18, scale: 0, mode: "string" }).notNull(),
    gstMinor: decimal("gstMinor", { precision: 18, scale: 0, mode: "string" }).notNull(),
    totalMinor: decimal("totalMinor", { precision: 18, scale: 0, mode: "string" }).notNull(),
    reviewedBy: int("reviewedBy").references(() => users.id, { onDelete: "restrict" }),
    reviewedAt: timestamp("reviewedAt"),
    reviewReason: text("reviewReason"),
    clientMutationId: varchar("clientMutationId", { length: 64 }).notNull().unique(),
    createdBy: int("createdBy")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    poNumberUnique: uniqueIndex("po_org_number_uq").on(table.organizationId, table.poNumber),
    poSiteStatusIndex: index("po_site_status_idx").on(table.siteId, table.status),
  }),
);

export const purchaseOrderLines = mysqlTable("purchase_order_lines", {
  id: varchar("id", { length: 36 }).primaryKey(),
  purchaseOrderId: varchar("purchaseOrderId", { length: 36 })
    .notNull()
    .references(() => purchaseOrders.id, { onDelete: "restrict" }),
  lineNumber: int("lineNumber").notNull(),
  materialItemId: varchar("materialItemId", { length: 36 }).references(() => materialItems.id, {
    onDelete: "restrict",
  }),
  description: varchar("description", { length: 300 }).notNull(),
  unitCode: varchar("unitCode", { length: 32 }).notNull(),
  quantityThousandths: decimal("quantityThousandths", {
    precision: 18,
    scale: 0,
    mode: "string",
  }).notNull(),
  rateMinor: decimal("rateMinor", { precision: 18, scale: 0, mode: "string" }).notNull(),
  gstBps: int("gstBps").notNull(),
  amountMinor: decimal("amountMinor", { precision: 18, scale: 0, mode: "string" }).notNull(),
});

/** Competing quotes recorded with a PO so the approver can compare. */
export const purchaseOrderQuotes = mysqlTable("purchase_order_quotes", {
  id: varchar("id", { length: 36 }).primaryKey(),
  purchaseOrderId: varchar("purchaseOrderId", { length: 36 })
    .notNull()
    .references(() => purchaseOrders.id, { onDelete: "restrict" }),
  vendorId: varchar("vendorId", { length: 36 }).references(() => vendors.id, {
    onDelete: "restrict",
  }),
  vendorName: varchar("vendorName", { length: 180 }).notNull(),
  totalMinor: decimal("totalMinor", { precision: 18, scale: 0, mode: "string" }).notNull(),
  deliveryDays: int("deliveryDays"),
  note: varchar("note", { length: 300 }),
  chosen: mysqlEnum("chosen", ["Yes", "No"]).default("No").notNull(),
});

export const goodsReceipts = mysqlTable(
  "goods_receipts",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 })
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    siteId: varchar("siteId", { length: 36 })
      .notNull()
      .references(() => sites.id, { onDelete: "restrict" }),
    purchaseOrderId: varchar("purchaseOrderId", { length: 36 })
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "restrict" }),
    grnNumber: varchar("grnNumber", { length: 40 }).notNull(),
    receivedOn: date("receivedOn", { mode: "string" }).notNull(),
    challanNumber: varchar("challanNumber", { length: 80 }),
    vehicleNumber: varchar("vehicleNumber", { length: 40 }),
    note: text("note"),
    clientMutationId: varchar("clientMutationId", { length: 64 }).notNull().unique(),
    createdBy: int("createdBy")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    grnNumberUnique: uniqueIndex("grn_org_number_uq").on(table.organizationId, table.grnNumber),
    grnPoIndex: index("grn_po_idx").on(table.purchaseOrderId),
  }),
);

export const goodsReceiptLines = mysqlTable("goods_receipt_lines", {
  id: varchar("id", { length: 36 }).primaryKey(),
  goodsReceiptId: varchar("goodsReceiptId", { length: 36 })
    .notNull()
    .references(() => goodsReceipts.id, { onDelete: "restrict" }),
  purchaseOrderLineId: varchar("purchaseOrderLineId", { length: 36 })
    .notNull()
    .references(() => purchaseOrderLines.id, { onDelete: "restrict" }),
  acceptedThousandths: decimal("acceptedThousandths", {
    precision: 18,
    scale: 0,
    mode: "string",
  }).notNull(),
  rejectedThousandths: decimal("rejectedThousandths", {
    precision: 18,
    scale: 0,
    mode: "string",
  }).notNull(),
  rejectReason: varchar("rejectReason", { length: 300 }),
  inventoryMovementId: varchar("inventoryMovementId", { length: 36 }),
});

/** A supplier bill (supplier_invoices) matched to the purchase order it is for. */
export const purchaseInvoiceLinks = mysqlTable("purchase_invoice_links", {
  invoiceId: varchar("invoiceId", { length: 36 })
    .primaryKey()
    .references(() => supplierInvoices.id, { onDelete: "restrict" }),
  purchaseOrderId: varchar("purchaseOrderId", { length: 36 })
    .notNull()
    .references(() => purchaseOrders.id, { onDelete: "restrict" }),
  linkedBy: int("linkedBy")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  linkedAt: timestamp("linkedAt").defaultNow().notNull(),
});
