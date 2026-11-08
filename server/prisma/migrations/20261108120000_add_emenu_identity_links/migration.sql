-- Additive identity bridge only. Existing users and product rows are not modified.
CREATE TABLE "public"."emenu_identity_links" (
    "id" TEXT NOT NULL,
    "authUserId" UUID NOT NULL,
    "emenuUserId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "emenu_identity_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "emenu_identity_links_authUserId_key" ON "public"."emenu_identity_links"("authUserId");
CREATE UNIQUE INDEX "emenu_identity_links_emenuUserId_key" ON "public"."emenu_identity_links"("emenuUserId");
CREATE INDEX "emenu_identity_links_email_idx" ON "public"."emenu_identity_links"("email");

ALTER TABLE "public"."emenu_identity_links"
  ADD CONSTRAINT "emenu_identity_links_emenuUserId_fkey"
  FOREIGN KEY ("emenuUserId") REFERENCES "public"."users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prisma accesses this table through the server-side database connection.
-- Public client roles receive no direct access.
ALTER TABLE "public"."emenu_identity_links" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."emenu_identity_links" FROM anon, authenticated;
