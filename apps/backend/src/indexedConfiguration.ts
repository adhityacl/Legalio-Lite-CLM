import type Database from 'better-sqlite3';

/** Searchable configuration columns derive from the versioned policy document, so they cannot drift. */
export function indexConfiguration(db: Database.Database) {
  const projections: Record<string, Record<string,string>> = {
    organization_settings: {
      legal_entity:'profile.legalEntity', brand_name:'profile.brandName', country_code:'policy.countryCode', industry:'policy.industry',
      language:'policy.language', timezone:'policy.timezone', default_currency:'policy.defaultCurrency', reporting_currency:'policy.reportingCurrency',
      expiry_warning_days:'policy.expiryWarningDays',
    },
    branding: { app_name:'appName',logo_url:'logoUrl',primary_color:'primaryColor',footer_text:'footerText',login_headline:'loginHeadline' },
    app_settings: { drive_folder_id:'driveFolderId',spreadsheet_id:'spreadsheetId',is_connected:'isConnected',auto_sync:'autoSync',ai_model:'aiModel' },
    news_ticker: { last_generated_at:'lastGeneratedAt' },
  };
  for(const [table,columns] of Object.entries(projections)) {
    if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
    const existing=(db.prepare(`PRAGMA table_xinfo("${table}")`).all() as any[]).map(column=>column.name);
    for(const [column,jsonPath] of Object.entries(columns)) if(!existing.includes(column)) {
      const type=['expiry_warning_days','is_connected','auto_sync'].includes(column)?'INTEGER':'TEXT';
      db.exec(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${type} GENERATED ALWAYS AS (json_extract(payload,'$.${jsonPath}')) VIRTUAL`);
    }
  }
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='organization_settings'").get()) db.exec('CREATE INDEX IF NOT EXISTS idx_v3_org_policy_country ON organization_settings(country_code, industry, organizationId)');
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='news_ticker'").get()) db.exec(`CREATE VIEW IF NOT EXISTS news_items AS
    SELECT ticker.id AS feed_id, CAST(item.key AS INTEGER) AS position, item.value AS item
    FROM news_ticker ticker, json_each(ticker.payload,'$.items') item`);
  for(const [table,index,columns] of [
    ['member','idx_v3_member_user_org','userId,organizationId'],
    ['team','idx_v3_team_org_name','organizationId,name'],
    ['teamMember','idx_v3_team_member_user','userId,teamId'],
    ['invitation','idx_v3_invitation_org_status','organizationId,status,expiresAt'],
    ['ai_ocr_cache','idx_v3_ocr_created','createdAt'],
  ]) if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) db.exec(`CREATE INDEX IF NOT EXISTS "${index}" ON "${table}"(${columns})`);
}
