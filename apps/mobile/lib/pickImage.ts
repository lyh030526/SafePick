import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

export type AttachedImage = { uri: string; base64_data: string; mime_type: 'image/jpeg' | 'image/png' | 'image/webp'; name: string };

// One image from the library, checked against the server's limits (4MB each, 8MB together, JPG/PNG/WebP).
// Returns null when the shopper cancels; throws with a message to show when the image cannot be used.
export async function pickImage(current: AttachedImage[], max: number): Promise<AttachedImage | null> {
  if (current.length >= max) throw new Error(`이미지는 최대 ${max}장까지 첨부할 수 있어요.`);
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.85 });
  if (picked.canceled) return null;
  const asset = picked.assets[0];
  let data = asset.base64;
  let mime = Platform.OS === 'web' ? asset.mimeType : 'image/jpeg';
  if (Platform.OS === 'web' && asset.file) {
    if (asset.file.size > 4 * 1024 * 1024) throw new Error('이미지는 한 장에 4MB 이하여야 해요. 필요한 부분을 잘라 주세요.');
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('이미지를 읽지 못했습니다.')); reader.readAsDataURL(asset.file!);
    });
    data = dataUrl.split(',')[1]; mime = asset.file.type;
  }
  if (!data) throw new Error('이미지를 읽지 못했습니다. 다른 파일을 선택해 주세요.');
  mime = data.startsWith('/9j/') ? 'image/jpeg' : data.startsWith('iVBORw0KGgo') ? 'image/png'
    : data.startsWith('UklGR') ? 'image/webp' : mime;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime ?? '')) throw new Error('JPG, PNG, WebP 이미지를 첨부해 주세요.');
  if (data.length > 5592408) throw new Error('이미지는 한 장에 4MB 이하여야 해요. 필요한 부분을 잘라 주세요.');
  if (current.reduce((sum, image) => sum + image.base64_data.length, data.length) > 11184816) {
    throw new Error('이미지는 합계 8MB 이내로 첨부해 주세요.');
  }
  return { uri: `data:${mime};base64,${data}`, base64_data: data, mime_type: mime as AttachedImage['mime_type'],
    name: asset.fileName || `이미지 ${current.length + 1}` };
}
