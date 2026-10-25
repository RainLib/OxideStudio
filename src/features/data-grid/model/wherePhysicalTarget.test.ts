import {expect,it} from "vitest";
import {buildWhereCompletionDocument} from "@/lib/whereCompletion";
import {isWherePhysicalTarget} from "./wherePhysicalTarget";
it.each([
 ["sta|Suffix > 0",true],
 ["users.sta|Suffix > 0",true],
 ["missing.sta|Suffix > 0",false],
 ["EXISTS (SELECT 1 FROM other_table o WHERE o.sta|Suffix = 1)",false],
 ["EXISTS (SELECT 1 FROM other_table o WHERE users.sta|Suffix = o.id)",true],
 ["EXISTS (SELECT 1 FROM (SELECT 1 AS status) x WHERE x.sta|Suffix = 1)",false],
 ["EXISTS (WITH users AS (SELECT 1 AS status) SELECT 1 FROM users WHERE sta|Suffix = 1)",false],
 ["EXISTS (SELECT 1 FROM other.users u WHERE u.sta|Suffix = 1)",false],
 ["EXISTS (SELECT 1 FROM app.users u WHERE u.sta|Suffix = 1)",true],
 ["EXISTS (SELECT 1 FROM app.users a JOIN other_table b ON a.id=b.id WHERE sta|Suffix = 1)",false],
 ["age IN (SELECT o.sta|Suffix FROM other_table o)",false],
 ["age IN (SELECT users.sta|Suffix FROM other_table o)",true],
 ["CASE WHEN EXISTS (SELECT 1 FROM other_table o WHERE o.sta|Suffix = 1) THEN 1 ELSE 0 END > 0",false],
 ["COALESCE((SELECT o.id FROM other_table o), sta|Suffix) > 0",true],
 ["age IN (WITH q AS (SELECT 1 AS status) SELECT q.sta|Suffix FROM q)",false],
 ["status = 'FROM other_table IN (' AND sta|Suffix > 0",true],
 ["status IS NOT DISTINCT FROM |",true],
 ["status IS DISTINCT FROM users.sta|Suffix",true],
 ["status IS /*😀*/ NOT DISTINCT /* FROM */ FROM |",true],
 ["status IS NOT DISTINCT FROM (SELECT o.sta|Suffix FROM other_table o)",false],
 ["status IS NOT DISTINCT FROM (SELECT users.sta|Suffix FROM other_table o)",true],
 ["EXISTS (SELECT 1 FROM other_table o WHERE o.status IS NOT DISTINCT FROM users.sta|Suffix)",true],
 ["EXISTS (SELECT 1 FROM other_table o WHERE o.status IS NOT DISTINCT FROM o.sta|Suffix)",false],
 ["status IS NOT DISTINCT FROM (COALESCE(users.sta|Suffix, 'x'))",true],
])("binds physical fallback for %s only when its actual relation matches (%s)",(marked,expected)=>{
 const condition=marked.replace("|","");const document=buildWhereCompletionDocument({condition,cursorOffset:marked.indexOf("|"),driver:"postgres",schema:"app",table:"users"});expect(isWherePhysicalTarget(document,{schema:"app",table:"users"})).toBe(expected);
});
