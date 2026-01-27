import React, {useState} from 'react';
import { View, TextInput, StyleSheet, ActivityIndicator, Button, KeyboardAvoidingView } from 'react-native';
import { FIREBASE_AUTH } from '../../FirebaseConfig';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';

const Login = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const auth = FIREBASE_AUTH;

    const signIn = async () => {
        setLoading(true);
        try {
            const response = await signInWithEmailAndPassword(auth,email,password);
            console.log(response);
        } catch (error:any) {
            console.log(error);
            alert("Signin: " + error.message);
        } finally {
            setLoading(false);
        }
        };

        const signUp = async () => {
        setLoading(true);
        try {
            const response = await createUserWithEmailAndPassword(auth,email,password);
            console.log(response);
        } catch (error:any) {
            console.log(error);
            alert("Sign up: " + error.message);
        } finally {
            setLoading(false);
        }
    };



return (
        <View style={styles.container}>
            <KeyboardAvoidingView behavior="padding">
            <TextInput 
                value={email} 
                style={styles.input} 
                placeholder="Email" 
                autoCapitalize="none" 
                onChangeText={(text) => setEmail(text)} 
            />
            <TextInput 
                value={password} 
                style={styles.input} 
                placeholder="Password" 
                autoCapitalize="none" 
                secureTextEntry={true}
                onChangeText={(text) => setPassword(text)} 
            />

            {loading ? (
                <ActivityIndicator size="large" color="#0000ff" />
            ) : (
                <>
                    <Button title="Login" onPress={signIn} />
                    <Button title="Create Account" onPress={signUp} />
                </>
            )}
            </KeyboardAvoidingView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
        alignItems: 'center',
        justifyContent: 'center',
    },
    input: {
        marginVertical: 4,
        height: 50,
        borderWidth: 1,
        borderRadius: 4,
        padding: 10,
        backgroundColor: '#fff'
    }
})

export default Login;
