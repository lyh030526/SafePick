import { StyleSheet, Text, View } from 'react-native';
import { colors } from './theme';

export function CheckCircle({ checked }: { checked: boolean }) {
  return (
    <View style={[styles.circle, checked && styles.checked]}>
      <Text style={styles.mark}>✓</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  checked: { backgroundColor: colors.blue },
  mark: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', lineHeight: 18 },
});
