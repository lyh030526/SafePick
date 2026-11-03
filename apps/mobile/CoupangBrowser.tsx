import { Text } from 'react-native';
import { Card, ScreenFrame, frame } from './ScreenFrame';

// The in-app browser needs a phone's WebView; in a web browser the PC extension does the same job.
export function CoupangBrowser(_props: { initialUrl?: string }) {
  return <ScreenFrame title="쿠팡에서 가져오기">
    <Card>
      <Text style={frame.body}>쿠팡 화면에서 바로 가져오기는 휴대폰 앱에서만 쓸 수 있어요. PC에서는 SafePick 확장 프로그램으로 쿠팡 상품 페이지를 가져와 주세요.</Text>
    </Card>
  </ScreenFrame>;
}
