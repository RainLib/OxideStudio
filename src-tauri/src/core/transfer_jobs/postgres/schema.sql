WITH RECURSIVE tree(oid) AS (
    SELECT $1::bigint::oid
    UNION SELECT i.inhrelid FROM pg_catalog.pg_inherits i JOIN tree t ON i.inhparent=t.oid
), types(oid) AS (
    SELECT a.atttypid FROM pg_catalog.pg_attribute a JOIN tree t ON a.attrelid=t.oid WHERE a.attnum>0 AND NOT a.attisdropped
    UNION
    SELECT edge.oid FROM types p JOIN pg_catalog.pg_type v ON v.oid=p.oid
    CROSS JOIN LATERAL (
        SELECT v.typelem AS oid WHERE v.typelem<>0
        UNION SELECT v.typbasetype WHERE v.typbasetype<>0
        UNION SELECT a.atttypid FROM pg_catalog.pg_attribute a WHERE a.attrelid=v.typrelid AND a.attnum>0 AND NOT a.attisdropped
        UNION SELECT r.rngsubtype FROM pg_catalog.pg_range r WHERE r.rngtypid=v.oid OR r.rngmultitypid=v.oid
    ) edge
), body AS (
SELECT pg_catalog.jsonb_build_object(
 'tables',(SELECT jsonb_agg(jsonb_build_array(c.oid,n.nspname,c.relname,c.relkind,c.relpersistence,c.relowner,c.relrowsecurity,c.relforcerowsecurity,c.relfilenode,c.reloptions,c.relpartbound::text,pg_catalog.pg_get_partkeydef(c.oid)) ORDER BY c.oid) FROM pg_catalog.pg_class c JOIN tree t ON c.oid=t.oid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace),
 'parents',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.inhrelid,i.inhseqno) FROM pg_catalog.pg_inherits i WHERE i.inhrelid IN (SELECT oid FROM tree) OR i.inhparent IN (SELECT oid FROM tree)),
 'attributes',(SELECT jsonb_agg(jsonb_build_array(a.attrelid,a.attnum,a.attname,a.atttypid,a.atttypmod,a.attcollation,a.attnotnull,a.attidentity,a.attgenerated,a.attisdropped,a.attinhcount,a.attislocal,a.attmissingval::text,pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attrelid,a.attnum) FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attnum>0 AND (a.attrelid IN (SELECT oid FROM tree) OR a.attrelid IN (SELECT typrelid FROM pg_catalog.pg_type WHERE oid IN (SELECT oid FROM types)))),
 'indexes',(SELECT jsonb_agg(jsonb_build_array(i.indexrelid,pg_catalog.pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready,i.indimmediate,i.indisreplident) ORDER BY i.indexrelid) FROM pg_catalog.pg_index i JOIN tree t ON i.indrelid=t.oid),
 'constraints',(SELECT jsonb_agg(jsonb_build_array(c.oid,to_jsonb(c),pg_catalog.pg_get_constraintdef(c.oid,true)) ORDER BY c.oid) FROM pg_catalog.pg_constraint c WHERE c.conrelid IN (SELECT oid FROM tree) OR c.contypid IN (SELECT oid FROM types)),
 'triggers',(SELECT jsonb_agg(jsonb_build_array(t.oid,to_jsonb(t),pg_catalog.pg_get_triggerdef(t.oid,true)) ORDER BY t.oid) FROM pg_catalog.pg_trigger t WHERE t.tgrelid IN (SELECT oid FROM tree)),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_catalog.pg_policy p WHERE p.polrelid IN (SELECT oid FROM tree)),
 'rules',(SELECT jsonb_agg(jsonb_build_array(r.oid,pg_catalog.pg_get_ruledef(r.oid,true)) ORDER BY r.oid) FROM pg_catalog.pg_rewrite r WHERE r.ev_class IN (SELECT oid FROM tree)),
 'types',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.oid) FROM pg_catalog.pg_type v JOIN types t ON t.oid=v.oid),
 'enum',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.enumtypid,e.enumsortorder) FROM pg_catalog.pg_enum e WHERE e.enumtypid IN (SELECT oid FROM types)),
 'ranges',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.rngtypid) FROM pg_catalog.pg_range r WHERE r.rngtypid IN (SELECT oid FROM types) OR r.rngmultitypid IN (SELECT oid FROM types)),
 'collations',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) FROM pg_catalog.pg_collation c WHERE c.oid IN (SELECT a.attcollation FROM pg_catalog.pg_attribute a WHERE a.attrelid IN (SELECT oid FROM tree))),
 'functions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_catalog.pg_proc p WHERE p.oid IN (
     SELECT tgfoid FROM pg_catalog.pg_trigger WHERE tgrelid IN (SELECT oid FROM tree)
     UNION SELECT typinput FROM pg_catalog.pg_type WHERE oid IN (SELECT oid FROM types)
     UNION SELECT typoutput FROM pg_catalog.pg_type WHERE oid IN (SELECT oid FROM types)
     UNION SELECT d.refobjid FROM pg_catalog.pg_depend d WHERE d.refclassid='pg_catalog.pg_proc'::regclass AND (
       d.classid='pg_catalog.pg_attrdef'::regclass AND d.objid IN (SELECT a.oid FROM pg_catalog.pg_attrdef a WHERE a.adrelid IN (SELECT oid FROM tree)) OR
       d.classid='pg_catalog.pg_constraint'::regclass AND d.objid IN (SELECT c.oid FROM pg_catalog.pg_constraint c WHERE c.conrelid IN (SELECT oid FROM tree) OR c.contypid IN (SELECT oid FROM types))
     )
 )),
 'sequences',(SELECT jsonb_agg(jsonb_build_array(to_jsonb(q),s.relowner,n.nspname,s.relname,a.refobjsubid) ORDER BY q.seqrelid) FROM pg_catalog.pg_sequence q JOIN pg_catalog.pg_class s ON s.oid=q.seqrelid JOIN pg_catalog.pg_namespace n ON n.oid=s.relnamespace JOIN pg_catalog.pg_depend a ON a.classid='pg_catalog.pg_class'::regclass AND a.objid=q.seqrelid AND a.refclassid='pg_catalog.pg_class'::regclass AND a.deptype IN ('a','i') WHERE a.refobjid IN (SELECT oid FROM tree))
)::text AS value
)
SELECT CASE WHEN octet_length(value)<=524288 AND (SELECT count(*) FROM tree)<=1024 AND (SELECT count(*) FROM types)<=1024 THEN value END FROM body
