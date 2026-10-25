import {createHash} from "node:crypto";
import {lstat,readFile,realpath} from "node:fs/promises";
import {isAbsolute,win32,relative,resolve,sep} from "node:path";

/** Mirror the Host's package closure: neither parent paths nor links may
 * substitute an entrypoint/classpath outside the manifest's own directory. */
async function packageFile(root,value,label) {
  if(typeof value!=="string"||!value||isAbsolute(value)||win32.isAbsolute(value))throw new Error(`${label} must be package-relative`);
  const parts=value.replaceAll("\\","/").split("/");
  if(parts.some(part=>!part||part==="."||part===".."||part.includes(":")))throw new Error(`${label} contains an unsafe relative path`);
  const target=resolve(root,...parts),boundary=relative(root,target);
  if(!boundary||boundary===".."||boundary.startsWith(".."+sep)||isAbsolute(boundary))throw new Error(`${label} escapes the package root`);
  let current=root;
  for(const [index,part] of parts.entries()) {
    current=resolve(current,part);const info=await lstat(current);
    if(info.isSymbolicLink())throw new Error(`${label} contains a symbolic link`);
    if(index<parts.length-1?!info.isDirectory():!info.isFile())throw new Error(`${label} is not a regular package file`);
  }
  return target;
}
async function checkedFile(root,path,digest,label) {
  const file=await packageFile(root,path,label);
  if(typeof digest!=="string"||!/^[a-f0-9]{64}$/iu.test(digest)||createHash("sha256").update(await readFile(file)).digest("hex")!==digest.toLowerCase())throw new Error(`${label} SHA-256 does not match the package manifest`);
  return file;
}
export async function validateDriverPackageFiles(manifest,directory) {
  const root=await realpath(directory),entrypoint=await checkedFile(root,manifest.entrypoint,manifest.sha256,"Driver entrypoint"),classpath=[];
  if(manifest.runtime?.kind==="java")for(const item of manifest.runtime.classpath||[])classpath.push(await checkedFile(root,item.path,item.sha256,"Java classpath"));
  return {root,entrypoint,classpath};
}
