import { uploadImageByGithub } from "./github";
import { uploadImageBySmms } from "./smms";
import { uploadImageByPicgo } from "./picgo";
import { uploadImageByS3 } from "./s3";
import { Store } from "@tauri-apps/plugin-store";
import { getNormalizedImageHosting } from "../image-hosting-config";
import {
  uploadImageByCloudinary,
  uploadImageByCustomHttp,
  uploadImageByImageKit,
  uploadImageByLsky,
  uploadImageByWebDav,
} from './remote-services';
import {
  uploadImageByQiniu,
  uploadImageByUpyun,
} from './china-object-services';

export async function uploadImage(file: File) {
  const store = await Store.load('store.json');

  //
  const useImageRepo = await store.get<boolean>('useImageRepo')
  const savedMainImageHosting = await store.get<string>('mainImageHosting')
  const normalizedImageHosting = getNormalizedImageHosting(savedMainImageHosting)
  const mainImageHosting = useImageRepo ? normalizedImageHosting.value : savedMainImageHosting

  if (!useImageRepo) {
    return undefined
  }

  // ， undefined
  if (!mainImageHosting || mainImageHosting === 'none') {
    return undefined
  }

  if (normalizedImageHosting.shouldPersist) {
    await store.set('mainImageHosting', normalizedImageHosting.value)
    await store.save()
  }

  switch (mainImageHosting) {
    case 'github':
      return uploadImageByGithub(file)
    case 'smms':
      return uploadImageBySmms(file)
    case 'picgo':
      return uploadImageByPicgo(file)
    case 's3':
      return uploadImageByS3(file)
    case 'lsky':
      return uploadImageByLsky(file)
    case 'webdav':
      return uploadImageByWebDav(file)
    case 'custom-http':
      return uploadImageByCustomHttp(file)
    case 'cloudinary':
      return uploadImageByCloudinary(file)
    case 'imagekit':
      return uploadImageByImageKit(file)
    case 'qiniu':
      return uploadImageByQiniu(file)
    case 'upyun':
      return uploadImageByUpyun(file)
    default:
      return undefined
  }
}
